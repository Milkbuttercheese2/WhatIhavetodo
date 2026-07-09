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

/// Opens `db_path`, recovering automatically instead of ever failing
/// outright:
///   1. Try `db_path` directly.
///   2. If that fails for any reason (corruption, an unreadable file,
///      whatever), try restoring the newest file in `backups_dir` over it
///      and opening that.
///   3. If that also fails (or there are no backups), quarantine whatever
///      is at `db_path` — renamed aside, never deleted — and start fresh.
/// Returns the connection plus a user-facing note describing what happened,
/// if anything did (None on the ordinary happy path). The caller is
/// expected to surface that note prominently (see lib.rs's startup dialog)
/// rather than let a silent recovery hide potential data loss.
pub fn open_with_recovery(
    db_path: &Path,
    backups_dir: &Path,
) -> DbResult<(Connection, Option<String>)> {
    let primary_err = match open(db_path) {
        Ok(conn) => return Ok((conn, None)),
        Err(e) => e,
    };
    eprintln!(
        "primary DB open failed at {}: {primary_err} — attempting recovery",
        db_path.display()
    );

    if let Some(backup) = newest_backup(backups_dir) {
        match fs::copy(&backup, db_path).and_then(|_| open(db_path).map_err(std::io::Error::other))
        {
            Ok(conn) => {
                let note = format!(
                    "원본 데이터베이스 파일을 열 수 없어({primary_err}) 가장 최근 자동 백업({})으로 복구했습니다.",
                    backup.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                );
                return Ok((conn, Some(note)));
            }
            Err(e) => eprintln!("backup {} also failed to restore/open: {e}", backup.display()),
        }
    }

    // Quarantine whatever's there (if anything) and start fresh — this must
    // succeed for the app to be usable at all, so it's the one case still
    // allowed to propagate an error up to the caller.
    if db_path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let quarantined = db_path.with_file_name(format!("wmhh.broken-{stamp}.sqlite"));
        let _ = fs::rename(db_path, &quarantined);
    }
    let conn = open(db_path)?;
    let note = format!(
        "데이터베이스를 열 수 없었고 사용 가능한 자동 백업도 없어 새로 시작합니다.\n\
         (문제가 있던 파일은 삭제하지 않고 옆에 보관해두었습니다.)\n원래 오류: {primary_err}"
    );
    Ok((conn, Some(note)))
}

/// Path used to stage a picked `.sqlite`/`.db` file for
/// `commands::import_backup_file` until it's safe to apply — see
/// `apply_pending_import`.
pub fn pending_import_path(db_path: &Path) -> PathBuf {
    db_path.with_file_name("wmhh.sqlite.pending-import")
}

/// If a staged import exists next to `db_path` (see `pending_import_path`),
/// apply it now: snapshot the current file into `backups_dir`, replace
/// `db_path` with the staged one, and remove the staging file.
///
/// MUST be called before any connection to `db_path` is opened in this
/// process. Importing used to `fs::copy` the picked file directly over
/// `db_path` from inside a running command — but that overwrote the exact
/// file this process's own live connection had open. The raw byte-copy
/// itself "succeeded" every time, but the stale open connection's later
/// teardown then corrupted what had just been written, so every import
/// came back as "couldn't open the original, recovered from backup" on the
/// very next launch. Staging the file and only ever applying it at the
/// start of a *fresh* process — before that process has opened anything —
/// avoids the conflict entirely.
pub fn apply_pending_import(db_path: &Path, backups_dir: &Path) -> DbResult<bool> {
    let pending = pending_import_path(db_path);
    if !pending.exists() {
        return Ok(false);
    }
    if db_path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        fs::create_dir_all(backups_dir)?;
        let _ = fs::copy(db_path, backups_dir.join(format!("wmhh_preimport_{stamp}.sqlite")));
    }
    if fs::rename(&pending, db_path).is_err() {
        // rename can fail across filesystem boundaries; fall back to copy+remove.
        fs::copy(&pending, db_path)?;
        fs::remove_file(&pending)?;
    }
    Ok(true)
}

fn newest_backup(backups_dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = fs::read_dir(backups_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
        .collect();
    entries.sort(); // filenames are zero-padded timestamps, so lexical order == chronological
    entries.pop()
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
