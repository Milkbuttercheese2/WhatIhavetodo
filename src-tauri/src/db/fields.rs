use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;
use super::model::FieldDef;

pub fn load_fields(conn: &Connection) -> DbResult<Vec<FieldDef>> {
    let mut stmt = conn.prepare(
        "SELECT key, label, type, on_flag, builtin FROM fields ORDER BY sort_order, key",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(FieldDef {
            key: row.get(0)?,
            label: row.get(1)?,
            type_: row.get(2)?,
            on: row.get::<_, i64>(3)? != 0,
            builtin: row.get::<_, i64>(4)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_fields_tx(tx: &Transaction, fields: &[FieldDef]) -> DbResult<()> {
    tx.execute("DELETE FROM fields", [])?;
    {
        // OR IGNORE: a duplicate key in this small config table must not
        // abort the whole save transaction (first occurrence wins). The
        // legacy app tolerated duplicates here; items stays strict.
        let mut ins = tx.prepare(
            "INSERT OR IGNORE INTO fields (key, label, type, on_flag, builtin, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (i, f) in fields.iter().enumerate() {
            ins.execute(params![f.key, f.label, f.type_, f.on as i64, f.builtin as i64, i as i64])?;
        }
    }
    Ok(())
}

pub fn save_fields(conn: &mut Connection, fields: &[FieldDef]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_fields_tx(&tx, fields)?;
    tx.commit()?;
    Ok(())
}
