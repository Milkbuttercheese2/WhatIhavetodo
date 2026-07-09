use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;
use super::model::Settings;

pub fn load_settings(conn: &Connection) -> DbResult<Settings> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut rows = stmt.query([])?;
    let mut settings = Settings::new();
    while let Some(row) = rows.next()? {
        let key: String = row.get(0)?;
        let raw: String = row.get(1)?;
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
        settings.insert(key, value);
    }
    Ok(settings)
}

pub fn save_settings_tx(tx: &Transaction, settings: &Settings) -> DbResult<()> {
    tx.execute("DELETE FROM settings", [])?;
    {
        let mut ins = tx.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2)")?;
        for (key, value) in settings.iter() {
            ins.execute(params![key, serde_json::to_string(value)?])?;
        }
    }
    Ok(())
}

pub fn save_settings(conn: &mut Connection, settings: &Settings) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_settings_tx(&tx, settings)?;
    tx.commit()?;
    Ok(())
}
