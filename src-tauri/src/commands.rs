use std::sync::atomic::Ordering;

use tauri::State;

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
