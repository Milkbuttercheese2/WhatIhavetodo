mod commands;
mod config;
mod db;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub struct AppDb {
    pub conn: Mutex<rusqlite::Connection>,
    pub db_path: PathBuf,
    pub backups_dir: PathBuf,
    /// Folder currently holding data/+backups/ — either the default
    /// app-local-data folder or a user-chosen one (see config.rs). Read by
    /// the `get_data_dir` command; changing it (via `choose_data_dir`)
    /// only takes effect after a restart, so this itself never mutates.
    pub base_dir: PathBuf,
    /// Fixed location of config.json, independent of base_dir.
    pub app_config_dir: PathBuf,
    /// Set once at startup from `db::integrity_check`. Commands refuse to
    /// operate while this is false rather than risk working from a
    /// partial/corrupt dataset — see the legacy app's `LOADED` gate, whose
    /// intent this preserves in the new architecture.
    pub integrity_ok: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance MUST be the first plugin registered. This app's
        // save model is a whole-dataset replace (save_all rewrites every
        // item row), so two live instances silently clobber each other's
        // edits — last writer wins with the *entire* dataset, not a row.
        // A second launch now just focuses the already-running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_config_dir = app
                .path()
                .app_config_dir()
                .expect("no app-config directory available on this platform");
            let mut cfg = config::load(&app_config_dir);
            let default_dir = || {
                app.path()
                    .app_local_data_dir()
                    .expect("no app-local-data directory available on this platform")
            };

            let configured = cfg.data_dir.clone().filter(|p| !p.is_empty());
            let mut move_note: Option<String> = None;
            let mut base_dir = match configured {
                Some(p) => PathBuf::from(p),
                None => {
                    let default_base = default_dir();
                    // 진짜 첫 실행에만 위치를 묻는다: 기본 위치에 이미 DB가
                    // 있으면 (이 기능 도입 전 사용자, 또는 예전에 선택을
                    // 건너뛴 사용자) 그 데이터를 계속 쓰는 것이 우선이다 —
                    // 여기서 새 위치를 고르게 하면 기존 데이터가 버려진
                    // 것처럼 보이는 사고가 된다.
                    if default_base.join("data").join("wmhh.sqlite").exists() {
                        default_base
                    } else {
                        // 데이터 저장 위치는 사용자가 정한다 — 특정 폴더에
                        // 말없이 자동 지정하지 않는 것이 이 앱의 방침.
                        let _ = app
                            .dialog()
                            .message(
                                "처음 실행합니다.\n\n확인을 누르면 폴더 선택창이 열립니다.\n업무 데이터를 보관할 위치를 선택해주세요 — 선택한 위치 안에 '뭐해야했더라_데이터' 폴더가 만들어집니다.\n\n(선택을 취소하면 Windows 기본 앱 데이터 폴더에 저장하며, 이후 [저장 위치] 버튼으로 언제든 옮길 수 있습니다.)",
                            )
                            .kind(MessageDialogKind::Info)
                            .title("데이터 저장 위치 선택")
                            .blocking_show();
                        match app
                            .dialog()
                            .file()
                            .blocking_pick_folder()
                            .and_then(|f| f.into_path().ok())
                        {
                            Some(picked) => {
                                let chosen = picked.join(config::DATA_FOLDER_NAME);
                                cfg.data_dir = Some(chosen.to_string_lossy().into_owned());
                                if let Err(e) = config::save(&app_config_dir, &cfg) {
                                    eprintln!("failed to persist first-run data_dir: {e}");
                                }
                                chosen
                            }
                            None => {
                                move_note = Some(format!(
                                    "저장 위치를 선택하지 않아 기본 위치를 사용합니다.\n{}\n\n[저장 위치] 버튼으로 언제든 옮길 수 있습니다.",
                                    default_base.display()
                                ));
                                default_base
                            }
                        }
                    }
                }
            };

            // Apply a relocation staged by choose_data_dir. Must happen
            // before ANY connection is opened (same principle as
            // apply_pending_import below). On failure, revert to the old
            // location entirely — keeping the user on their real data beats
            // starting empty at an uninitialized new location.
            if let Some(old) = cfg.pending_move_from.clone().filter(|p| !p.is_empty()) {
                let old_base = PathBuf::from(&old);
                if old_base != base_dir {
                    match db::apply_pending_move(&old_base, &base_dir) {
                        Ok(()) => {
                            move_note = Some(format!(
                                "저장 위치 변경을 적용했습니다.\n{} → {}",
                                old_base.display(),
                                base_dir.display()
                            ));
                        }
                        Err(e) => {
                            eprintln!(
                                "pending move {} -> {} failed: {e} — reverting to old location",
                                old_base.display(),
                                base_dir.display()
                            );
                            move_note = Some(format!(
                                "새 저장 위치로 데이터를 옮기지 못해({e}) 기존 위치를 계속 사용합니다.\n기존 위치: {}",
                                old_base.display()
                            ));
                            base_dir = old_base;
                            cfg.data_dir = Some(base_dir.to_string_lossy().into_owned());
                        }
                    }
                }
                cfg.pending_move_from = None;
                if let Err(e) = config::save(&app_config_dir, &cfg) {
                    eprintln!("failed to persist config after pending move: {e}");
                }
            }

            // The app must always launch, no matter what's wrong with
            // storage — a bad configured path (unplugged USB drive,
            // deleted folder), a corrupt DB file, anything. This never
            // crashes: `open_with_recovery` tries the primary file, then
            // the newest auto-backup, then a fresh empty DB at the same
            // location; if even that location itself is unusable (e.g. the
            // whole configured drive is gone), fall back to the default
            // location entirely.
            let attempt = |base: &PathBuf| {
                let db_path = base.join("data").join("wmhh.sqlite");
                let backups_dir = base.join("backups");
                // Must run before anything in this process opens db_path —
                // see the comment on db::apply_pending_import for why.
                let applied_import = db::apply_pending_import(&db_path, &backups_dir)
                    .unwrap_or_else(|e| {
                        eprintln!("failed to apply pending import at {}: {e}", db_path.display());
                        false
                    });
                db::open_with_recovery(&db_path, &backups_dir).map(|(conn, note)| {
                    let note = if applied_import {
                        Some(match note {
                            Some(n) => format!("가져온 데이터베이스를 적용했습니다.\n\n{n}"),
                            None => "가져온 데이터베이스를 적용했습니다.".to_string(),
                        })
                    } else {
                        note
                    };
                    (conn, db_path, backups_dir, note)
                })
            };

            let (conn, db_path, backups_dir, note) = match attempt(&base_dir) {
                Ok(result) => result,
                Err(e) => {
                    let attempted = base_dir.display().to_string();
                    eprintln!(
                        "could not open or recover a database at {attempted}: {e} — falling back to the default location"
                    );
                    base_dir = default_dir();
                    match attempt(&base_dir) {
                        Ok((conn, db_path, backups_dir, note)) => {
                            let combined = format!(
                                "지정된 저장 위치를 사용할 수 없어 기본 위치로 시작합니다.\n\n지정 위치: {attempted}\n\n{}",
                                note.unwrap_or_else(|| "(기본 위치에서 정상적으로 열렸습니다.)".into())
                            );
                            (conn, db_path, backups_dir, Some(combined))
                        }
                        Err(e2) => {
                            let _ = app
                                .dialog()
                                .message(format!(
                                    "데이터베이스를 열 수 없어 앱을 시작할 수 없습니다.\n\n{e2}"
                                ))
                                .kind(MessageDialogKind::Error)
                                .title("실행 불가")
                                .blocking_show();
                            std::process::exit(1);
                        }
                    }
                }
            };

            let note = match (move_note, note) {
                (Some(m), Some(n)) => Some(format!("{m}\n\n{n}")),
                (m, n) => m.or(n),
            };
            if let Some(msg) = &note {
                let _ = app
                    .dialog()
                    .message(msg.clone())
                    .kind(MessageDialogKind::Warning)
                    .title("저장소 알림")
                    .blocking_show();
            }

            let integrity_ok = match db::integrity_check(&conn) {
                Ok(Ok(())) => true,
                Ok(Err(report)) => {
                    eprintln!(
                        "DB integrity check FAILED — refusing further writes until restored: {report}"
                    );
                    false
                }
                Err(e) => {
                    eprintln!("DB integrity check errored: {e}");
                    false
                }
            };

            app.manage(AppDb {
                conn: Mutex::new(conn),
                db_path,
                backups_dir,
                base_dir,
                app_config_dir,
                integrity_ok: AtomicBool::new(integrity_ok),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_all,
            commands::save_all,
            commands::save_fields,
            commands::save_presets,
            commands::save_id_kinds,
            commands::save_settings,
            commands::backup_export,
            commands::backup_import,
            commands::get_data_dir,
            commands::choose_data_dir,
            commands::restart_app,
            commands::focus_main_window,
            commands::save_text_file,
            commands::save_binary_file,
            commands::import_backup_file,
            commands::cancel_pending_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
