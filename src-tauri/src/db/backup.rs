use rusqlite::Connection;

use super::error::DbResult;
use super::model::{AppState, BackupPayload};
use super::{fields, id_kinds, items, presets, recur_defs, settings};

/// Matches the legacy HTML app's `backupPayload()` `v:5` shape so JSON
/// backups remain interchangeable between the old and new app.
pub const BACKUP_VERSION: i32 = 5;

pub fn load_app_state(conn: &Connection) -> DbResult<AppState> {
    Ok(AppState {
        items: items::load_items(conn)?,
        fields: fields::load_fields(conn)?,
        presets: presets::load_presets(conn)?,
        id_kinds: id_kinds::load_id_kinds(conn)?,
        settings: settings::load_settings(conn)?,
        recur_defs: recur_defs::load_recur_defs(conn)?,
    })
}

pub fn export_payload(conn: &Connection) -> DbResult<BackupPayload> {
    let state = load_app_state(conn)?;
    let exported: String =
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get(0))?;
    Ok(BackupPayload {
        v: BACKUP_VERSION,
        exported,
        fields: state.fields,
        presets: state.presets,
        id_kinds: state.id_kinds,
        settings: state.settings,
        items: state.items,
        recur_defs: state.recur_defs,
    })
}

/// Restores every table from a backup payload as a single all-or-nothing
/// transaction (the caller is expected to have taken a fresh auto-backup
/// of the live .sqlite file immediately before calling this, as a second
/// line of defense — see commands::backup_import).
pub fn import_payload(conn: &mut Connection, payload: BackupPayload) -> DbResult<()> {
    let tx = conn.transaction()?;
    fields::save_fields_tx(&tx, &payload.fields)?;
    presets::save_presets_tx(&tx, &payload.presets)?;
    id_kinds::save_id_kinds_tx(&tx, &payload.id_kinds)?;
    settings::save_settings_tx(&tx, &payload.settings)?;
    recur_defs::save_recur_defs_tx(&tx, &payload.recur_defs)?;
    items::save_items_tx(&tx, &payload.items)?;
    tx.commit()?;
    Ok(())
}
