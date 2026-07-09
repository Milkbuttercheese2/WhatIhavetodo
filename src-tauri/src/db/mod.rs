pub mod alarm;
pub mod backup;
pub mod error;
pub mod fields;
pub mod id_kinds;
pub mod items;
pub mod model;
pub mod presets;
mod schema;
pub mod settings;
#[cfg(test)]
mod tests;

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use error::DbResult;

/// Opens (creating if needed) the SQLite database at `path`, applies the
/// pragmas this app relies on, and runs any pending migrations.
pub fn open(path: &Path) -> DbResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    // Single-user desktop app, small write volume: durability over
    // throughput, and this avoids WAL's -wal/-shm sidecar files, which have
    // been observed to conflict with endpoint AV on gov intranet PCs.
    conn.pragma_update(None, "synchronous", "FULL")?;
    schema::migrate(&mut conn)?;
    Ok(conn)
}

/// Runs `PRAGMA integrity_check`. Anything other than "ok" means the file
/// is corrupt — callers must refuse to proceed with an empty/partial
/// dataset in that case (this replaces the legacy app's `LOADED` gate,
/// which existed for the same reason: never let an empty state silently
/// overwrite real data).
pub fn integrity_check(conn: &Connection) -> DbResult<Result<(), String>> {
    let result: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if result == "ok" {
        Ok(Ok(()))
    } else {
        Ok(Err(result))
    }
}

/// Filesystem-safe timestamp for naming backup files.
pub fn now_stamp(conn: &Connection) -> DbResult<String> {
    Ok(conn.query_row("SELECT strftime('%Y%m%d_%H%M%S','now')", [], |r| r.get(0))?)
}

/// Copies the live database file into `backups_dir` with a timestamped
/// name, then prunes to the newest `keep` files. This is insurance
/// independent of the manual JSON export — cheap protection against schema
/// bugs or an accidental bulk delete.
pub fn rotate_backup(db_path: &Path, backups_dir: &Path, stamp: &str, keep: usize) -> DbResult<()> {
    fs::create_dir_all(backups_dir)?;
    let dest = backups_dir.join(format!("wmhh_{stamp}.sqlite"));
    fs::copy(db_path, &dest)?;

    let mut entries: Vec<PathBuf> = fs::read_dir(backups_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
        .collect();
    entries.sort(); // filenames are zero-padded timestamps, so lexical order == chronological
    if entries.len() > keep {
        for old in &entries[..entries.len() - keep] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}
