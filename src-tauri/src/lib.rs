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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_config_dir = app
                .path()
                .app_config_dir()
                .expect("no app-config directory available on this platform");
            let cfg = config::load(&app_config_dir);
            let default_dir = || {
                app.path()
                    .app_local_data_dir()
                    .expect("no app-local-data directory available on this platform")
            };

            let configured = cfg.data_dir.filter(|p| !p.is_empty());
            let mut base_dir = configured.map(PathBuf::from).unwrap_or_else(default_dir);

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
