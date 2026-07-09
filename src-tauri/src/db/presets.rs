use std::collections::HashMap;

use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;
use super::model::Preset;

pub fn load_presets(conn: &Connection) -> DbResult<Vec<Preset>> {
    let mut subs_by_preset: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT preset_id, title FROM preset_subs ORDER BY preset_id, sort_order")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let preset_id: String = row.get(0)?;
            subs_by_preset.entry(preset_id).or_default().push(row.get(1)?);
        }
    }

    let mut stmt = conn.prepare("SELECT id, label, sum FROM presets ORDER BY sort_order, id")?;
    let mut rows = stmt.query([])?;
    let mut presets = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        presets.push(Preset {
            subs: subs_by_preset.remove(&id).unwrap_or_default(),
            id,
            label: row.get(1)?,
            sum: row.get(2)?,
        });
    }
    Ok(presets)
}

pub fn save_presets_tx(tx: &Transaction, presets: &[Preset]) -> DbResult<()> {
    tx.execute("DELETE FROM presets", [])?; // cascades to preset_subs
    {
        let mut ins_preset = tx.prepare(
            "INSERT INTO presets (id, label, sum, sort_order) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut ins_sub = tx.prepare(
            "INSERT INTO preset_subs (preset_id, title, sort_order) VALUES (?1, ?2, ?3)",
        )?;
        for (i, p) in presets.iter().enumerate() {
            ins_preset.execute(params![p.id, p.label, p.sum, i as i64])?;
            for (j, title) in p.subs.iter().enumerate() {
                ins_sub.execute(params![p.id, title, j as i64])?;
            }
        }
    }
    Ok(())
}

pub fn save_presets(conn: &mut Connection, presets: &[Preset]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_presets_tx(&tx, presets)?;
    tx.commit()?;
    Ok(())
}
