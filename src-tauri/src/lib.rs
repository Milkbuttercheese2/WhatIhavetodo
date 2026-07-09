mod commands;
mod db;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use tauri::Manager;

pub struct AppDb {
    pub conn: Mutex<rusqlite::Connection>,
    pub db_path: PathBuf,
    pub backups_dir: PathBuf,
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
            let base = app
                .path()
                .app_local_data_dir()
                .expect("no app-local-data directory available on this platform");
            let db_path = base.join("data").join("wmhh.sqlite");
            let backups_dir = base.join("backups");

            let conn = db::open(&db_path).expect("failed to open/migrate database");

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
