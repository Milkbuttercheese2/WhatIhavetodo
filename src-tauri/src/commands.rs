use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::config::{self, AppConfig};
use crate::db;
use crate::db::model::{AppState, BackupPayload, FieldDef, Item, Preset, Settings};
use crate::AppDb;

/// How many rotated .sqlite backups to keep (see db::rotate_backup).
const BACKUP_KEEP: usize = 20;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn load_all(state: State<AppDb>) -> Result<AppState, String> {
    if !state.integrity_ok.load(Ordering::Relaxed) {
        return Err(
            "데이터베이스 무결성 검사에 실패했습니다. 자동 백업 또는 JSON 백업에서 복원이 필요합니다."
                .into(),
        );
    }
    let conn = state.conn.lock().map_err(to_err)?;
    db::backup::load_app_state(&conn).map_err(to_err)
}

#[tauri::command]
pub fn save_all(state: State<AppDb>, items: Vec<Item>) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::items::save_items(&mut conn, &items).map_err(to_err)?;
    let stamp = db::now_stamp(&conn).map_err(to_err)?;
    drop(conn);
    // Best-effort: a failed backup rotation must not fail the save itself
    // (the save already committed by this point).
    if let Err(e) = db::rotate_backup(&state.db_path, &state.backups_dir, &stamp, BACKUP_KEEP) {
        eprintln!("backup rotation failed: {e}");
    }
    Ok(())
}

#[tauri::command]
pub fn save_fields(state: State<AppDb>, fields: Vec<FieldDef>) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::fields::save_fields(&mut conn, &fields).map_err(to_err)
}

#[tauri::command]
pub fn save_presets(state: State<AppDb>, presets: Vec<Preset>) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::presets::save_presets(&mut conn, &presets).map_err(to_err)
}

#[tauri::command]
pub fn save_id_kinds(state: State<AppDb>, id_kinds: Vec<String>) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::id_kinds::save_id_kinds(&mut conn, &id_kinds).map_err(to_err)
}

#[tauri::command]
pub fn save_settings(state: State<AppDb>, settings: Settings) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::settings::save_settings(&mut conn, &settings).map_err(to_err)
}

#[tauri::command]
pub fn backup_export(state: State<AppDb>) -> Result<BackupPayload, String> {
    let conn = state.conn.lock().map_err(to_err)?;
    db::backup::export_payload(&conn).map_err(to_err)
}

#[tauri::command]
pub fn backup_import(state: State<AppDb>, payload: BackupPayload) -> Result<(), String> {
    // Safety net before a destructive whole-dataset overwrite: snapshot the
    // live file under a distinguishable name before touching anything.
    {
        let conn = state.conn.lock().map_err(to_err)?;
        let stamp = db::now_stamp(&conn).map_err(to_err)?;
        drop(conn);
        db::rotate_backup(
            &state.db_path,
            &state.backups_dir,
            &format!("prerestore_{stamp}"),
            BACKUP_KEEP,
        )
        .map_err(to_err)?;
    }
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::backup::import_payload(&mut conn, payload).map_err(to_err)
}

#[tauri::command]
pub fn get_data_dir(state: State<AppDb>) -> String {
    state.base_dir.to_string_lossy().into_owned()
}

/// Name of the dedicated subfolder created under whatever *location* the
/// user picks in `choose_data_dir` — e.g. picking "D:\" results in
/// "D:\뭐해야했더라_데이터\". This means the user only ever has to point at
/// a location (Desktop, a drive, a project folder — anything, even one
/// full of unrelated files), never at a specific empty folder, and our own
/// subfolder is always created fresh so it can never collide with
/// pre-existing files at the picked path.
const DATA_FOLDER_NAME: &str = "뭐해야했더라_데이터";

/// Opens a native folder picker for a *location*; if the user chooses one,
/// creates `<location>/뭐해야했더라_데이터/`, copies the current DB file +
/// backups into it, and points config.json at the new location. Does NOT
/// switch the live connection — the caller must restart the app (see
/// `restart_app`) for the new location to take effect, which keeps this
/// simple and avoids juggling an in-flight SQLite connection.
#[tauri::command]
pub async fn choose_data_dir(app: AppHandle, state: State<'_, AppDb>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let new_base = picked.into_path().map_err(to_err)?.join(DATA_FOLDER_NAME);

    let new_data_dir = new_base.join("data");
    let new_backups_dir = new_base.join("backups");
    std::fs::create_dir_all(&new_data_dir).map_err(to_err)?;
    std::fs::create_dir_all(&new_backups_dir).map_err(to_err)?;

    {
        // Block writes momentarily so the file we copy is consistent.
        let _conn = state.conn.lock().map_err(to_err)?;
        std::fs::copy(&state.db_path, new_data_dir.join("wmhh.sqlite")).map_err(to_err)?;
    }
    if state.backups_dir.is_dir() {
        for entry in std::fs::read_dir(&state.backups_dir).map_err(to_err)? {
            let entry = entry.map_err(to_err)?;
            if entry.path().is_file() {
                std::fs::copy(entry.path(), new_backups_dir.join(entry.file_name()))
                    .map_err(to_err)?;
            }
        }
    }

    config::save(
        &state.app_config_dir,
        &AppConfig {
            data_dir: Some(new_base.to_string_lossy().into_owned()),
        },
    )?;

    Ok(Some(new_base.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}

/// Brings the main window to the foreground even if another window
/// currently has focus — used when an alarm fires so the user notices it
/// instead of relying on browser-style window.focus(), which can't
/// actually steal focus from other applications.
#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.unminimize().map_err(to_err)?;
        win.show().map_err(to_err)?;
        win.set_focus().map_err(to_err)?;
    }
    Ok(())
}

/// Opens a native "save as" dialog and writes `content` to wherever the
/// user picks. Returns false if the user cancelled.
///
/// The frontend used to trigger downloads by clicking a hidden
/// `<a download>` link to a blob: URL — that's a browser trick, and a Tauri
/// webview has no download manager to catch it, so it silently did nothing
/// (both the JSON backup and the XLSX export were affected). Routing
/// through a real native save dialog is the actual fix.
#[tauri::command]
pub async fn save_text_file(app: AppHandle, suggested_name: String, content: String) -> Result<bool, String> {
    let Some(path) = app.dialog().file().set_file_name(&suggested_name).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(to_err)?;
    std::fs::write(path, content).map_err(to_err)?;
    Ok(true)
}

/// Same as `save_text_file` but for binary output (XLSX).
#[tauri::command]
pub async fn save_binary_file(app: AppHandle, suggested_name: String, data: Vec<u8>) -> Result<bool, String> {
    let Some(path) = app.dialog().file().set_file_name(&suggested_name).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(to_err)?;
    std::fs::write(path, data).map_err(to_err)?;
    Ok(true)
}

/// What `import_backup_file` picked and did.
#[derive(serde::Serialize)]
#[serde(tag = "kind")]
pub enum ImportResult {
    Cancelled,
    /// A .json backup was picked — its raw text is handed back to the
    /// frontend, which already knows how to parse/reconcile/persist it
    /// (unchanged from before; no restart needed, it goes through the
    /// normal save_all path).
    Json { content: String },
    /// A .sqlite/.db file was picked and has already replaced the live
    /// database on disk. Needs a restart to take effect.
    Db,
}

/// One unified "불러오기" entry point for both backup formats: opens a
/// single native file picker accepting `.json` or `.sqlite`/`.db`, and
/// dispatches based on the picked file's extension.
#[tauri::command]
pub async fn import_backup_file(app: AppHandle, state: State<'_, AppDb>) -> Result<ImportResult, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("백업 파일 (JSON 또는 DB)", &["json", "sqlite", "db"])
        .blocking_pick_file()
    else {
        return Ok(ImportResult::Cancelled);
    };
    let picked_path = picked.into_path().map_err(to_err)?;
    let ext = picked_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "json" {
        let content = std::fs::read_to_string(&picked_path).map_err(to_err)?;
        return Ok(ImportResult::Json { content });
    }

    // .sqlite / .db path — validate before touching anything live: must
    // actually open, pass its own integrity check, and look like one of
    // our databases.
    let check_conn = rusqlite::Connection::open(&picked_path).map_err(to_err)?;
    let integrity: String = check_conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(to_err)?;
    if integrity != "ok" {
        return Err(format!("선택한 파일이 손상되어 있습니다: {integrity}"));
    }
    let has_items: i64 = check_conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'",
            [],
            |r| r.get(0),
        )
        .map_err(to_err)?;
    if has_items == 0 {
        return Err("선택한 파일이 이 프로그램의 데이터베이스 형식이 아닙니다.".into());
    }
    drop(check_conn);

    // Do NOT copy over state.db_path here — this process's own AppDb.conn
    // is a live, open connection to that exact file. Overwriting a
    // SQLite file's bytes out from under a connection that still has it
    // open (even just idle, even on Windows where the raw byte-copy
    // itself "succeeds") reliably left the file unreadable on next
    // launch — every import ended up "recovered from backup" instead of
    // actually applying, because the stale open connection's own
    // teardown corrupted what we'd just written. Instead, stage the
    // picked file next to the real one; `db::apply_pending_import` moves
    // it into place at the start of the *next* process's startup, before
    // any connection has been opened at all.
    std::fs::copy(&picked_path, db::pending_import_path(&state.db_path)).map_err(to_err)?;
    Ok(ImportResult::Db)
}
