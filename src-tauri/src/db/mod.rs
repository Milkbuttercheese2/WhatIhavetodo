pub mod alarm;
pub mod backup;
pub mod error;
pub mod fields;
pub mod id_kinds;
pub mod items;
pub mod model;
pub mod presets;
pub mod recur_defs;
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
        let quarantined = db_path.with_file_name(format!("wmhh.broken-{}.sqlite", fs_stamp()));
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
        fs::create_dir_all(backups_dir)?;
        let _ = fs::copy(
            db_path,
            backups_dir.join(format!("wmhh_preimport_{}.sqlite", fs_stamp())),
        );
    }
    if fs::rename(&pending, db_path).is_err() {
        // rename can fail across filesystem boundaries; fall back to copy+remove.
        fs::copy(&pending, db_path)?;
        fs::remove_file(&pending)?;
    }
    Ok(true)
}

/// Extracts the embedded `YYYYMMDD_HHMMSS` timestamp (8 digits, '_', 6 digits)
/// from a backup filename, ignoring the `wmhh_` / `wmhh_preimport_` /
/// `wmhh_prerestore_` prefix. Sorting by THIS (not the raw filename) is what
/// keeps chronological order across mixed prefixes: a raw lexical sort puts
/// every `pre*` file after every regular one (the byte after `wmhh_` is `'p'`
/// (0x70) for pre-files vs a digit `'2'` (0x32) for regular ones, and
/// `'2' < 'p'`), which made recovery restore a stale `prerestore` snapshot and
/// pruning delete recent regular backups (v2.5.11 fix). Files with no stamp
/// fall back to the whole name so ordering stays deterministic.
fn stamp_key(p: &Path) -> String {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = name.as_bytes();
    let mut start = 0usize;
    while start + 15 <= bytes.len() {
        let s = &bytes[start..start + 15];
        if s[..8].iter().all(|b| b.is_ascii_digit())
            && s[8] == b'_'
            && s[9..15].iter().all(|b| b.is_ascii_digit())
        {
            return name[start..start + 15].to_string();
        }
        start += 1;
    }
    name
}

fn newest_backup(backups_dir: &Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = fs::read_dir(backups_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
        .collect();
    // Sort by embedded timestamp, NOT filename — prefixes (wmhh_/preimport_/prerestore_)
    // break a raw lexical sort. See stamp_key.
    entries.sort_by(|a, b| stamp_key(a).cmp(&stamp_key(b)));
    entries.pop()
}

/// Filesystem-safe timestamp when no connection is at hand (pre-open code
/// paths). Uses a throwaway in-memory SQLite for strftime so every backup
/// filename shares one format — mixed formats (unix epoch vs YYYYMMDD)
/// both read poorly next to each other and confuse `prune_backups`'s
/// date extraction.
fn fs_stamp() -> String {
    Connection::open_in_memory()
        .and_then(|c| {
            c.query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| {
                r.get::<_, String>(0)
            })
        })
        .unwrap_or_else(|_| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
                .to_string()
        })
}

/// Filesystem-safe timestamp for naming backup files. Must use 'localtime'
/// like `fs_stamp` does — `newest_backup`/`prune_backups` sort by the embedded
/// `YYYYMMDD_HHMMSS` stamp (see `stamp_key`), so all stamps must share one
/// clock; mixing a UTC stamp with localtime ones would misorder them (an older
/// localtime file could sort after a newer UTC one, so recovery would restore
/// stale data).
pub fn now_stamp(conn: &Connection) -> DbResult<String> {
    Ok(conn.query_row("SELECT strftime('%Y%m%d_%H%M%S','now','localtime')", [], |r| r.get(0))?)
}

/// Copies the live database file into `backups_dir` with a timestamped
/// name, then prunes (see `prune_backups`). This is insurance independent
/// of the manual JSON export — cheap protection against schema bugs or an
/// accidental bulk delete. Unconditional: used for forced snapshots
/// (pre-import/pre-restore); the ordinary after-save path goes through
/// `rotate_backup_throttled` instead.
pub fn rotate_backup(db_path: &Path, backups_dir: &Path, stamp: &str, keep: usize) -> DbResult<()> {
    fs::create_dir_all(backups_dir)?;
    let dest = backups_dir.join(format!("wmhh_{stamp}.sqlite"));
    fs::copy(db_path, &dest)?;
    prune_backups(backups_dir, keep)?;
    Ok(())
}

/// Like `rotate_backup`, but skips (returning false) when the newest
/// existing backup is younger than `min_interval`.
///
/// Without the throttle, every save rotated a backup — and saves fire on
/// every user action, so all `keep` slots filled up within minutes of a
/// single editing session. That makes the rotation useless as protection:
/// by the time you notice bad data, every retained backup already contains
/// it. Throttling spreads the slots across hours/days of real use.
pub fn rotate_backup_throttled(
    db_path: &Path,
    backups_dir: &Path,
    stamp: &str,
    keep: usize,
    min_interval: std::time::Duration,
) -> DbResult<bool> {
    let newest_mtime = fs::read_dir(backups_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().map(|ext| ext == "sqlite").unwrap_or(false)
        })
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()))
        .max();
    if let Some(mtime) = newest_mtime {
        if let Ok(age) = std::time::SystemTime::now().duration_since(mtime) {
            if age < min_interval {
                return Ok(false);
            }
        }
    }
    rotate_backup(db_path, backups_dir, stamp, keep)?;
    Ok(true)
}

/// Deletes old backups, keeping (a) the newest `keep` files and (b) the
/// FIRST backup of each calendar day for the 14 most recent days seen.
/// (b) is what makes the rotation meaningful over time: even during a
/// heavy editing session that churns through all `keep` recent slots, a
/// start-of-day restore point per day survives for two weeks.
fn prune_backups(backups_dir: &Path, keep: usize) -> DbResult<()> {
    let mut entries: Vec<PathBuf> = fs::read_dir(backups_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|ext| ext == "sqlite").unwrap_or(false))
        .collect();
    // Sort by embedded timestamp, NOT filename (mixed prefixes break lexical order — see stamp_key).
    entries.sort_by(|a, b| stamp_key(a).cmp(&stamp_key(b)));

    // First file per parsed YYYYMMDD date, for the newest 14 distinct dates.
    let date_of = |p: &Path| -> Option<String> {
        let name = p.file_name()?.to_string_lossy().into_owned();
        let bytes = name.as_bytes();
        let mut run_start = None;
        for (i, b) in bytes.iter().enumerate() {
            if b.is_ascii_digit() {
                let start = *run_start.get_or_insert(i);
                if i - start + 1 == 8 {
                    return Some(name[start..=i].to_string());
                }
            } else {
                run_start = None;
            }
        }
        None
    };
    let mut first_of_day: std::collections::BTreeMap<String, PathBuf> = Default::default();
    for p in &entries {
        if let Some(d) = date_of(p) {
            first_of_day.entry(d).or_insert_with(|| p.clone());
        }
    }
    let protected: std::collections::HashSet<PathBuf> = first_of_day
        .into_iter()
        .rev() // newest dates first
        .take(14)
        .map(|(_, p)| p)
        .collect();

    if entries.len() > keep {
        let cutoff = entries.len() - keep;
        for old in &entries[..cutoff] {
            if !protected.contains(old) {
                let _ = fs::remove_file(old);
            }
        }
    }
    Ok(())
}

/// Applies a relocation staged by `commands::choose_data_dir`: copies the
/// database, any staged import, and all backups from `old_base` into
/// `new_base`. MUST run before anything in this process opens the DB.
/// The copy deliberately happens here (next launch) rather than at choose
/// time so that edits made between choosing a new location and actually
/// restarting are carried over instead of silently left behind.
pub fn apply_pending_move(old_base: &Path, new_base: &Path) -> DbResult<()> {
    let old_db = old_base.join("data").join("wmhh.sqlite");
    let new_data = new_base.join("data");
    fs::create_dir_all(&new_data)?;
    if old_db.exists() {
        fs::copy(&old_db, new_data.join("wmhh.sqlite"))?;
    }
    let old_pending = pending_import_path(&old_db);
    if old_pending.exists() {
        fs::copy(&old_pending, pending_import_path(&new_data.join("wmhh.sqlite")))?;
        let _ = fs::remove_file(&old_pending);
    }
    let old_backups = old_base.join("backups");
    let new_backups = new_base.join("backups");
    fs::create_dir_all(&new_backups)?;
    if old_backups.is_dir() {
        for entry in fs::read_dir(&old_backups)?.filter_map(|e| e.ok()) {
            if entry.path().is_file() {
                let _ = fs::copy(entry.path(), new_backups.join(entry.file_name()));
            }
        }
    }
    Ok(())
}
