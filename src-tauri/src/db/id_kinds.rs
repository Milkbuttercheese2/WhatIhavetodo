use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;

pub fn load_id_kinds(conn: &Connection) -> DbResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT kind FROM id_kinds ORDER BY sort_order, kind")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_id_kinds_tx(tx: &Transaction, kinds: &[String]) -> DbResult<()> {
    tx.execute("DELETE FROM id_kinds", [])?;
    {
        // OR IGNORE — see fields.rs: dup rows must not abort the whole save.
        let mut ins = tx.prepare("INSERT OR IGNORE INTO id_kinds (kind, sort_order) VALUES (?1, ?2)")?;
        for (i, k) in kinds.iter().enumerate() {
            ins.execute(params![k, i as i64])?;
        }
    }
    Ok(())
}

pub fn save_id_kinds(conn: &mut Connection, kinds: &[String]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_id_kinds_tx(&tx, kinds)?;
    tx.commit()?;
    Ok(())
}
