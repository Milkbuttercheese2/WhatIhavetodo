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
        "SELECT id, memo, received_at, due_at, staged, done, done_at, due_alarm, recur_id FROM items ORDER BY id",
    )?;
    let mut rows = stmt.query([])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let received_at: Option<String> = row.get(2)?;
        let due_at: Option<String> = row.get(3)?;
        let due_alarm: Option<String> = row.get(7)?;
        let recur_id: Option<i64> = row.get(8)?;

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
            done: row.get::<_, i64>(5)? != 0,
            done_at: row.get(6)?,
            staged: row.get::<_, i64>(4)? != 0,
            al: alarm::decode(due_alarm.as_deref(), "due"),
            recur_id,
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
            "INSERT INTO items (id, memo, received_at, due_at, staged, done, done_at, due_alarm, recur_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
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

        for it in items {
            let received = it.f.get("received").cloned();
            let due = it.f.get("due").cloned();
            let due_alarm = alarm::encode(&it.al, "due");
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
