mod commands;
mod config;
mod db;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
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

/// 트레이 '열기'·아이콘 클릭 공용 — focus_main_window 커맨드와 같은 동작.
fn open_main_window(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // "--autostart"는 Run 키에 박히는 표식 인자일 뿐이다 — 시작 시
        // 최소화 여부는 그때그때 settings(autostartMinimized)로 판단해야
        // 토글이 레지스트리 재작성 없이 즉시 반영된다.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        // 메인 창 닫기(X): closeToTray(기본 켬)면 종료 대신 트레이로 숨김.
        // 종료 경로는 여기(app.exit)와 트레이 '종료' 둘로 일원화 — 숨은
        // capture 창이 프로세스를 몰래 살려두는 좀비 경로를 만들지 않는다.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let close_to_tray = app
                    .try_state::<AppDb>()
                    .and_then(|db| {
                        let conn = db.conn.lock().ok()?;
                        db::settings::load_settings(&conn).ok()
                    })
                    .and_then(|s| s.get("closeToTray").and_then(|v| v.as_bool()))
                    .unwrap_or(true);
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    // 첫 회 안내 토스트용 — 프론트(capture-bridge.js)가 소비
                    let _ = app.emit_to("main", "wmhh://hidden-to-tray", ());
                } else {
                    app.exit(0);
                }
            }
        })
        .setup(|app| {
            // conf에서 main을 visible:false로 바꾼 것은 '시작 시 최소화'를
            // 깜빡임 없이 지원하기 위해서다. 일반 실행은 즉시 표시하고,
            // 자동 시작(--autostart)일 때만 아래에서 설정을 보고 결정한다.
            let autostart_launch = std::env::args().any(|a| a == "--autostart");
            if !autostart_launch {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            }

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
                                "처음 실행합니다.\n\n확인을 누르면 폴더 선택창이 열립니다.\n업무 데이터를 보관할 위치를 선택해주세요 — 선택한 위치 안에 '뭐하려했더라_데이터' 폴더가 만들어집니다.\n\n(선택을 취소하면 Windows 기본 앱 데이터 폴더에 저장하며, 이후 [저장 위치] 버튼으로 언제든 옮길 수 있습니다.)",
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

            /* ---- v2.23: 전역 캡처 단축키 + 트레이 상주 + 자동 시작 ---- */
            let startup_settings = db::settings::load_settings(&conn).unwrap_or_default();
            let sget_bool = |k: &str, d: bool| {
                startup_settings.get(k).and_then(|v| v.as_bool()).unwrap_or(d)
            };

            // 캡처 단축키 등록 — v2.31부터 Ctrl+Alt+Space 고정(변경 UI 없음).
            // 어떤 실패도 기동을 막지 않는다(다른 앱이 조합을 선점했을 수
            // 있음) — 그 경우 단축키 없이 뜬다.
            if let Err(e) =
                commands::register_capture_shortcut(app.handle(), commands::CAPTURE_SHORTCUT)
            {
                eprintln!(
                    "capture shortcut '{}' 등록 실패: {e} — 단축키 없이 시작",
                    commands::CAPTURE_SHORTCUT
                );
            }

            // 트레이 — 창을 닫아도(X) 여기 남아서 단축키가 계속 산다.
            // 명시적 종료는 이 메뉴의 '종료'가 유일한 정상 경로.
            let open_i = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_i, &quit_i])?;
            let mut tray = TrayIconBuilder::with_id("wmhh-tray")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("뭐하려 했더라")
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => open_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        open_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // 자동 시작이 켜져 있으면 매 시작마다 enable()을 재호출 —
            // 포터블 exe가 다른 폴더로 옮겨졌을 때 Run 키 경로를 자가 치유.
            if sget_bool("autostart", false) {
                use tauri_plugin_autostart::ManagerExt;
                if let Err(e) = app.autolaunch().enable() {
                    eprintln!("autostart 재등록 실패: {e}");
                }
            }

            // 자동 시작 실행이지만 '시작 시 최소화'가 꺼져 있으면 창 표시
            if autostart_launch && !sget_bool("autostartMinimized", true) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            }

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
            commands::alarm_attention,
            commands::save_text_file,
            commands::save_binary_file,
            commands::import_backup_file,
            commands::cancel_pending_import,
            commands::pick_file_path,
            commands::open_file_path,
            commands::reveal_file_path,
            commands::quick_search,
            commands::resize_capture,
            commands::get_ui_scale,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
