use std::collections::HashMap;

use rusqlite::Connection;

use super::model::*;
use super::{backup, fields, id_kinds, items, presets, settings};

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    super::schema::migrate(&mut conn).unwrap();
    conn
}

fn sample_items() -> Vec<Item> {
    let mut f1 = HashMap::new();
    f1.insert("received".to_string(), "2026-07-01T09:00:00.000Z".to_string());
    f1.insert("due".to_string(), "2026-07-05T18:00:00.000Z".to_string());
    f1.insert("custom1".to_string(), "커스텀 값".to_string());

    let mut al1 = AlarmMap::new();
    al1.insert("due".to_string(), AlarmState::Fired(true));

    let mut sub_al = AlarmMap::new();
    sub_al.insert("mid".to_string(), AlarmState::SnoozeUntil(1_800_000_000_000));

    let item1 = Item {
        id: 1001,
        memo: "민원 전화 — 재발급 문의".to_string(),
        f: f1,
        contacts: vec![Contact {
            who: "홍길동".into(),
            org: "행정과".into(),
            phone: "010-1111-2222".into(),
        }],
        ids: vec![Identifier {
            kind: "SR번호".into(),
            val: "SR-2026-001".into(),
        }],
        subs: vec![SubTask {
            id: 2001,
            title: "서류 확인".into(),
            mid: "2026-07-03T10:00:00.000Z".into(),
            done: false,
            al: sub_al,
        }],
        done: false,
        done_at: None,
        staged: true,
        al: al1,
    };

    let item2 = Item {
        id: 1002,
        memo: "완료된 업무".to_string(),
        f: HashMap::new(),
        contacts: vec![],
        ids: vec![],
        subs: vec![],
        done: true,
        done_at: Some(1_752_000_000_000),
        staged: false,
        al: AlarmMap::new(),
    };

    vec![item1, item2]
}

#[test]
fn items_round_trip() {
    let mut conn = test_conn();
    let original = sample_items();
    items::save_items(&mut conn, &original).unwrap();
    let loaded = items::load_items(&conn).unwrap();

    assert_eq!(loaded.len(), original.len());
    for (o, l) in original.iter().zip(loaded.iter()) {
        assert_eq!(o.id, l.id);
        assert_eq!(o.memo, l.memo);
        assert_eq!(o.f, l.f);
        assert_eq!(o.contacts.len(), l.contacts.len());
        assert_eq!(o.ids.len(), l.ids.len());
        assert_eq!(o.subs.len(), l.subs.len());
        assert_eq!(o.done, l.done);
        assert_eq!(o.done_at, l.done_at);
        assert_eq!(o.staged, l.staged);
    }

    // Subtask id and alarm state must survive the round trip unchanged
    // (never reassigned) — the legacy frontend keeps alarm-fired state
    // embedded on the subtask object itself.
    assert_eq!(loaded[0].subs[0].id, 2001);
    match loaded[0].subs[0].al.get("mid") {
        Some(AlarmState::SnoozeUntil(ms)) => assert_eq!(*ms, 1_800_000_000_000),
        other => panic!("expected snooze alarm state, got {other:?}"),
    }
    match loaded[0].al.get("due") {
        Some(AlarmState::Fired(true)) => {}
        other => panic!("expected fired due alarm, got {other:?}"),
    }
}

#[test]
fn save_all_replaces_rather_than_appends() {
    let mut conn = test_conn();
    items::save_items(&mut conn, &sample_items()).unwrap();
    assert_eq!(items::load_items(&conn).unwrap().len(), 2);

    // Saving a smaller set must fully replace, not merge with what's there.
    let smaller = vec![sample_items().remove(0)];
    items::save_items(&mut conn, &smaller).unwrap();
    let loaded = items::load_items(&conn).unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, 1001);
}

#[test]
fn fields_presets_id_kinds_settings_round_trip() {
    let mut conn = test_conn();

    let flds = vec![
        FieldDef {
            key: "received".into(),
            label: "접수시각".into(),
            type_: "datetime".into(),
            on: true,
            builtin: true,
        },
        FieldDef {
            key: "due".into(),
            label: "마감시각".into(),
            type_: "datetime".into(),
            on: true,
            builtin: true,
        },
    ];
    fields::save_fields(&mut conn, &flds).unwrap();
    assert_eq!(fields::load_fields(&conn).unwrap().len(), 2);

    let presets = vec![Preset {
        id: "p1".into(),
        label: "민원 접수".into(),
        sum: "민원 접수 처리".into(),
        subs: vec!["서류 확인".into(), "회신".into()],
    }];
    presets::save_presets(&mut conn, &presets).unwrap();
    let loaded_presets = presets::load_presets(&conn).unwrap();
    assert_eq!(loaded_presets.len(), 1);
    assert_eq!(
        loaded_presets[0].subs,
        vec!["서류 확인".to_string(), "회신".to_string()]
    );

    let kinds = vec!["입찰공고번호".to_string(), "SR번호".to_string()];
    id_kinds::save_id_kinds(&mut conn, &kinds).unwrap();
    assert_eq!(id_kinds::load_id_kinds(&conn).unwrap(), kinds);

    let mut settings = Settings::new();
    settings.insert("alarmOn".to_string(), serde_json::Value::Bool(true));
    settings::save_settings(&mut conn, &settings).unwrap();
    let loaded_settings = settings::load_settings(&conn).unwrap();
    assert_eq!(
        loaded_settings.get("alarmOn"),
        Some(&serde_json::Value::Bool(true))
    );
}

#[test]
fn backup_export_import_round_trip() {
    let mut conn = test_conn();
    items::save_items(&mut conn, &sample_items()).unwrap();

    let mut settings = Settings::new();
    settings.insert("alarmOn".to_string(), serde_json::Value::Bool(false));
    settings::save_settings(&mut conn, &settings).unwrap();

    let payload = backup::export_payload(&conn).unwrap();
    assert_eq!(payload.v, backup::BACKUP_VERSION);
    assert_eq!(payload.items.len(), 2);

    // Simulate importing into a fresh database, as would happen migrating
    // from the legacy HTML app's JSON backup.
    let mut fresh = test_conn();
    backup::import_payload(&mut fresh, payload).unwrap();
    let restored = items::load_items(&fresh).unwrap();
    assert_eq!(restored.len(), 2);
    let restored_settings = settings::load_settings(&fresh).unwrap();
    assert_eq!(
        restored_settings.get("alarmOn"),
        Some(&serde_json::Value::Bool(false))
    );
}

#[test]
fn fresh_db_is_seeded_with_defaults() {
    // A brand-new DB must already contain the same defaults the frontend
    // has always fallen back to (DEFAULT_ID_KINDS / CORE_FIELDS in app.js).
    // Without this seed, a fresh install's first `load_all()` would return
    // an empty id_kinds list, and — unlike the old IndexedDB-backed
    // STORE, where "key never written" and "explicitly saved empty" were
    // distinguishable — the frontend can't tell those apart from a SQL
    // SELECT, so it would wrongly treat "empty" as "user cleared it".
    let conn = test_conn();
    let kinds = id_kinds::load_id_kinds(&conn).unwrap();
    assert_eq!(
        kinds,
        vec!["입찰공고번호", "계약체결번호", "공사관리번호", "SR번호", "국민신문고번호"]
    );

    let flds = fields::load_fields(&conn).unwrap();
    let keys: Vec<&str> = flds.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys, vec!["received", "due"]);
    assert!(flds.iter().all(|f| f.on && f.builtin));
}

#[test]
fn integrity_check_reports_ok_on_fresh_db() {
    let conn = test_conn();
    assert_eq!(super::integrity_check(&conn).unwrap(), Ok(()));
}

#[test]
fn open_persists_across_simulated_restart() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_open_{}", std::process::id()));
    let db_path = dir.join("test.sqlite");
    let _ = std::fs::remove_dir_all(&dir);

    {
        let mut conn = super::open(&db_path).unwrap();
        items::save_items(&mut conn, &sample_items()).unwrap();
    } // conn dropped — simulates closing the app

    {
        // Reopen: re-runs migrate() against an already-migrated file, which
        // must be a no-op, and the data from before "restart" must still
        // be there.
        let conn = super::open(&db_path).unwrap();
        let loaded = items::load_items(&conn).unwrap();
        assert_eq!(loaded.len(), 2);
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn backup_rotation_keeps_only_newest_n() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_rot_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);

    let _conn = super::open(&db_path).unwrap();
    for i in 0..5 {
        let stamp = format!("{i:04}");
        super::rotate_backup(&db_path, &backups_dir, &stamp, 3).unwrap();
    }

    let entries: Vec<_> = std::fs::read_dir(&backups_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .collect();
    assert_eq!(entries.len(), 3);

    let _ = std::fs::remove_dir_all(&dir);
}
