use std::collections::HashMap;

use rusqlite::{params, Connection, Transaction};

use super::alarm;
use super::error::DbResult;
use super::model::{Contact, Identifier, Item, SubTask};

pub fn load_items(conn: &Connection) -> DbResult<Vec<Item>> {
    // Grouped bulk queries (few queries beats N+1 prepares per item).
    let mut fields_by_item: HashMap<i64, HashMap<String, String>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT item_id, field_key, value FROM item_fields")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let item_id: i64 = row.get(0)?;
            let key: String = row.get(1)?;
            let value: Option<String> = row.get(2)?;
            fields_by_item
                .entry(item_id)
                .or_default()
                .insert(key, value.unwrap_or_default());
        }
    }

    let mut contacts_by_item: HashMap<i64, Vec<Contact>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT item_id, who, org, phone FROM contacts ORDER BY item_id, sort_order, id",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let item_id: i64 = row.get(0)?;
            contacts_by_item.entry(item_id).or_default().push(Contact {
                who: row.get(1)?,
                org: row.get(2)?,
                phone: row.get(3)?,
            });
        }
    }

    let mut ids_by_item: HashMap<i64, Vec<Identifier>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT item_id, kind, val FROM identifiers ORDER BY item_id, sort_order, id",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let item_id: i64 = row.get(0)?;
            ids_by_item.entry(item_id).or_default().push(Identifier {
                kind: row.get(1)?,
                val: row.get(2)?,
            });
        }
    }

    let mut files_by_item: HashMap<i64, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT item_id, path FROM item_files ORDER BY item_id, sort_order, id")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let item_id: i64 = row.get(0)?;
            files_by_item.entry(item_id).or_default().push(row.get(1)?);
        }
    }

    let mut subs_by_item: HashMap<i64, Vec<SubTask>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT item_id, id, title, mid_at, done, alarm FROM subtasks ORDER BY item_id, sort_order, id",
        )?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let item_id: i64 = row.get(0)?;
            let sub_id: i64 = row.get(1)?;
            let mid_at: Option<String> = row.get(3)?;
            let alarm_text: Option<String> = row.get(5)?;
            subs_by_item.entry(item_id).or_default().push(SubTask {
                id: sub_id,
                title: row.get(2)?,
                mid: mid_at.unwrap_or_default(),
                done: row.get::<_, i64>(4)? != 0,
                al: alarm::decode(alarm_text.as_deref(), "mid"),
            });
        }
    }

    let mut stmt = conn.prepare(
        "SELECT id, memo, received_at, due_at, staged, done, done_at, due_alarm, recur_id, recur FROM items ORDER BY id",
    )?;
    let mut rows = stmt.query([])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let received_at: Option<String> = row.get(2)?;
        let due_at: Option<String> = row.get(3)?;
        let due_alarm: Option<String> = row.get(7)?;
        let recur_id: Option<i64> = row.get(8)?;
        let recur_text: Option<String> = row.get(9)?;
        let recur = recur_text.and_then(|t| serde_json::from_str(&t).ok());

        let mut f = fields_by_item.remove(&id).unwrap_or_default();
        if let Some(r) = received_at {
            f.insert("received".to_string(), r);
        }
        if let Some(d) = due_at {
            f.insert("due".to_string(), d);
        }

        items.push(Item {
            id,
            memo: row.get(1)?,
            f,
            contacts: contacts_by_item.remove(&id).unwrap_or_default(),
            ids: ids_by_item.remove(&id).unwrap_or_default(),
            subs: subs_by_item.remove(&id).unwrap_or_default(),
            files: files_by_item.remove(&id).unwrap_or_default(),
            done: row.get::<_, i64>(5)? != 0,
            done_at: row.get(6)?,
            staged: row.get::<_, i64>(4)? != 0,
            al: alarm::decode(due_alarm.as_deref(), "due"),
            recur_id,
            recur,
        });
    }
    Ok(items)
}

/// Full replace within `tx`: clears every item-related table and reinserts
/// from `items`. Ids are taken as given (never reassigned) so alarm state
/// embedded in subtasks stays attached to the right row across saves.
/// Caller controls the transaction boundary (see `save_items` and
/// `backup::import_payload` for the two callers).
pub fn save_items_tx(tx: &Transaction, items: &[Item]) -> DbResult<()> {
    tx.execute("DELETE FROM items", [])?; // cascades to item_fields/contacts/identifiers/subtasks
    {
        let mut ins_item = tx.prepare(
            "INSERT INTO items (id, memo, received_at, due_at, staged, done, done_at, due_alarm, recur_id, recur, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        )?;
        let mut ins_field =
            tx.prepare("INSERT INTO item_fields (item_id, field_key, value) VALUES (?1, ?2, ?3)")?;
        let mut ins_contact = tx.prepare(
            "INSERT INTO contacts (item_id, who, org, phone, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut ins_ident = tx.prepare(
            "INSERT INTO identifiers (item_id, kind, val, sort_order) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut ins_sub = tx.prepare(
            "INSERT INTO subtasks (id, item_id, title, mid_at, done, alarm, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let mut ins_file = tx
            .prepare("INSERT INTO item_files (item_id, path, sort_order) VALUES (?1, ?2, ?3)")?;

        for it in items {
            let received = it.f.get("received").cloned();
            let due = it.f.get("due").cloned();
            let due_alarm = alarm::encode(&it.al, "due");
            let recur_text = it.recur.as_ref().map(|v| v.to_string());
            ins_item.execute(params![
                it.id,
                it.memo,
                received,
                due,
                it.staged as i64,
                it.done as i64,
                it.done_at,
                due_alarm,
                it.recur_id,
                recur_text,
            ])?;

            for (k, v) in it
                .f
                .iter()
                .filter(|(k, _)| k.as_str() != "received" && k.as_str() != "due")
            {
                ins_field.execute(params![it.id, k, v])?;
            }
            for (i, c) in it.contacts.iter().enumerate() {
                ins_contact.execute(params![it.id, c.who, c.org, c.phone, i as i64])?;
            }
            for (i, x) in it.ids.iter().enumerate() {
                ins_ident.execute(params![it.id, x.kind, x.val, i as i64])?;
            }
            for (i, s) in it.subs.iter().enumerate() {
                let mid = if s.mid.is_empty() { None } else { Some(s.mid.clone()) };
                let sub_alarm = alarm::encode(&s.al, "mid");
                ins_sub.execute(params![s.id, it.id, s.title, mid, s.done as i64, sub_alarm, i as i64])?;
            }
            for (i, p) in it.files.iter().enumerate() {
                ins_file.execute(params![it.id, p, i as i64])?;
            }
        }
    }
    Ok(())
}

/// Mirrors the frontend's STORE.saveAll(), which always ships the complete
/// current item list — a single all-or-nothing transaction.
pub fn save_items(conn: &mut Connection, items: &[Item]) -> DbResult<()> {
    let tx = conn.transaction()?;
    save_items_tx(&tx, items)?;
    tx.commit()?;
    Ok(())
}

/// 빠른 검색(미니 캡처 창의 검색 모드) — 메모·세부 제목·관련인·식별번호·
/// 파일 경로를 LIKE로 뒤져 (id, memo, done) 목록만 돌려준다. 본 검색 규칙의
/// 원본은 프론트 filters.js의 haystack이고, 이것은 메인 모듈에 접근할 수
/// 없는 캡처 웹뷰를 위한 근사 검색이다 (읽기 전용).
pub fn quick_search(conn: &Connection, query: &str, limit: i64) -> DbResult<Vec<(i64, String, bool)>> {
    let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    let pat = format!("%{escaped}%");
    let mut stmt = conn.prepare(
        "SELECT DISTINCT i.id, i.memo, i.done FROM items i
         LEFT JOIN subtasks s ON s.item_id = i.id
         LEFT JOIN contacts c ON c.item_id = i.id
         LEFT JOIN identifiers x ON x.item_id = i.id
         LEFT JOIN item_files fl ON fl.item_id = i.id
         WHERE i.memo LIKE ?1 ESCAPE '\\' OR s.title LIKE ?1 ESCAPE '\\'
            OR c.who LIKE ?1 ESCAPE '\\' OR c.org LIKE ?1 ESCAPE '\\' OR c.phone LIKE ?1 ESCAPE '\\'
            OR x.kind LIKE ?1 ESCAPE '\\' OR x.val LIKE ?1 ESCAPE '\\'
            OR fl.path LIKE ?1 ESCAPE '\\'
         ORDER BY i.done ASC, i.id DESC LIMIT ?2",
    )?;
    let mut rows = stmt.query(params![pat, limit])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        out.push((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? != 0));
    }
    Ok(out)
}
