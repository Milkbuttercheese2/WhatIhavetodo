use std::sync::LazyLock;

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// Ordered schema migrations, tracked via SQLite's built-in `PRAGMA
/// user_version` (what rusqlite_migration uses internally) — no separate
/// version table needed.
///
/// IMPORTANT: only ever append new `M::up(...)` entries here. Never edit or
/// reorder an entry once it has shipped — the app has no auto-updater on
/// the target intranet, so an install may jump straight from an old schema
/// version to the newest one, skipping several releases at once.
static MIGRATIONS: LazyLock<Migrations<'static>> = LazyLock::new(|| {
    Migrations::new(vec![
        M::up(include_str!("migrations/001_init.sql")),
        M::up(include_str!("migrations/002_recurrence.sql")),
        M::up(include_str!("migrations/003_item_files.sql")),
        M::up(include_str!("migrations/004_recur.sql")),
    ])
});

pub fn migrate(conn: &mut Connection) -> Result<(), rusqlite_migration::Error> {
    MIGRATIONS.to_latest(conn)
}
