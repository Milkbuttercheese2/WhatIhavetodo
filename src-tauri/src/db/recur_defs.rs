use rusqlite::{params, Connection, Transaction};

use super::error::DbResult;
use super::model::{RecurDef, RecurTime};

pub fn load_recur_defs(conn: &Connection) -> DbResult<Vec<RecurDef>> {
    let mut stmt = conn.prepare(
        "SELECT id, memo, freq, dow, time_hh, time_mm, next_at, paused
         FROM recur_defs ORDER BY sort_order, id",
    )?;
    let mut rows = stmt.query([])?;
    let mut defs = Vec::new();
    while let Some(row) = rows.next()? {
        let dow_json: Option<String> = row.get(3)?;
        // Bad JSON degrades to an empty weekday list rather than failing the
        // whole load — one corrupt rule shouldn't hide every definition.
        let dow = dow_json
            .as_deref()
            .and_then(|s| serde_json::from_str::<Vec<i64>>(s).ok())
            .unwrap_or_default();
        let next_at: Option<String> = row.get(6)?;
        defs.push(RecurDef {
            id: row.get(0)?,
            memo: row.get(1)?,
            freq: row.get(2)?,
            dow,
            time: RecurTime {
                hh: row.get(4)?,
                mm: row.get(5)?,
            },
            next: next_at.unwrap_or_default(),
            paused: row.get::<_, i64>(7)? != 0,
        });
    }
    Ok(defs)
}

pub fn save_recur_defs_tx(tx: &Transaction, defs: &[RecurDef]) -> DbResult<()> {
    tx.execute("DELETE FROM recur_defs", [])?;
    {
        // OR IGNORE — see fields.rs/presets.rs: a dup id must not abort the save.
        let mut ins = tx.prepare(
            "INSERT OR IGNORE INTO recur_defs
             (id, memo, freq, dow, time_hh, time_mm, next_at, paused, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for (i, d) in defs.iter().enumerate() {
            let dow = serde_json::to_string(&d.dow).unwrap_or_else(|_| "[]".to_string());
            let next = if d.next.is_empty() { None } else { Some(d.next.clone()) };
            ins.execute(params![
                d.id,
                d.memo,
                d.freq,
                dow,
                d.time.hh,
                d.time.mm,
                next,
                d.paused as i64,
                i as i64,
            ])?;
        }
    }
    Ok(())
}

// v2.31: save_recur_defs 커맨드(정기함 UI)가 제거돼 프로덕션 호출자는 없지만,
// 다른 테이블 모듈과의 _tx/래퍼 대칭 유지 + 라운드트립 테스트용으로 남긴다.
#[cfg_attr(not(test), allow(dead_code))]
pub fn save_recur_defs(conn: &mut Connection, defs: &[RecurDef]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_recur_defs_tx(&tx, defs)?;
    tx.commit()?;
    Ok(())
}
