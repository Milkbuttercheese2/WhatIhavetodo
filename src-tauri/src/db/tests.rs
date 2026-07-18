use std::collections::HashMap;

use rusqlite::Connection;

use super::model::*;
use super::{backup, fields, id_kinds, items, presets, recur_defs, settings};

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
        owner: "박주무관".to_string(),
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
            owner: "김담당".into(),
            mid: "2026-07-03T10:00:00.000Z".into(),
            done: false,
            al: sub_al,
        }],
        files: vec![
            "C:\\업무\\재발급 안내.hwp".to_string(),
            "\\\\share\\민원\\양식.xlsx".to_string(),
        ],
        done: false,
        done_at: None,
        staged: true,
        al: al1,
        recur_id: Some(3001),
        recur: Some(serde_json::json!({"type":"dow","dow":[1,3],"time":"09:00"})),
    };

    let item2 = Item {
        id: 1002,
        memo: "완료된 업무".to_string(),
        owner: String::new(),
        f: HashMap::new(),
        contacts: vec![],
        ids: vec![],
        subs: vec![],
        files: vec![],
        done: true,
        done_at: Some(1_752_000_000_000),
        staged: false,
        al: AlarmMap::new(),
        recur_id: None,
        recur: None,
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

    // recur_id (soft link to a recur_def) survives; a hand-made item stays None.
    assert_eq!(loaded[0].recur_id, Some(3001));
    assert_eq!(loaded[1].recur_id, None);

    // v3.0.0 파일 링크: 경로 문자열과 순서가 그대로 왕복 (UNC 경로 포함).
    assert_eq!(loaded[0].files, original[0].files);
    assert!(loaded[1].files.is_empty());

    // v3.1.0 주기 업무: recur JSON이 손대지 않고 왕복, 없는 아이템은 None.
    assert_eq!(loaded[0].recur, original[0].recur);
    assert_eq!(loaded[1].recur, None);

    // v2.5.0 담당자: 아이템·세부의 owner가 그대로 왕복, 빈 값("" = 본인)도 보존.
    assert_eq!(loaded[0].owner, "박주무관");
    assert_eq!(loaded[0].subs[0].owner, "김담당");
    assert_eq!(loaded[1].owner, "");

    // 빠른 검색: 메모·세부 제목·식별번호 어느 쪽으로도 걸리고 LIKE 특수문자는 이스케이프
    let hits = items::quick_search(&conn, "재발급", 10).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].0, 1001);
    let hits = items::quick_search(&conn, "서류 확인", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let hits = items::quick_search(&conn, "SR-2026", 10).unwrap();
    assert_eq!(hits.len(), 1);
    let hits = items::quick_search(&conn, "%", 10).unwrap(); // 리터럴 % — 와일드카드로 새지 않음
    assert_eq!(hits.len(), 0);
    // EXISTS 최적화 검증: 관련인·파일명 서브쿼리로도 걸리고, 여러 필드에 동시에 걸려도
    // (예: "재발급"이 메모+파일명 양쪽 매치) 결과는 중복 없이 정확히 1건.
    assert_eq!(items::quick_search(&conn, "행정과", 10).unwrap().len(), 1);     // 관련소속(contacts)
    assert_eq!(items::quick_search(&conn, "홍길동", 10).unwrap().len(), 1);     // 관련인(contacts)
    // 연락처: 하이픈 그대로도, 숫자만(01011112222)으로도 걸린다 (v2.5.1)
    assert_eq!(items::quick_search(&conn, "010-1111-2222", 10).unwrap().len(), 1);
    assert_eq!(items::quick_search(&conn, "01011112222", 10).unwrap().len(), 1);
    assert_eq!(items::quick_search(&conn, "양식.xlsx", 10).unwrap().len(), 1);  // 파일명(item_files)
    let dup = items::quick_search(&conn, "재발급", 10).unwrap();               // 메모+파일 동시 매치
    assert_eq!(dup.len(), 1);
    assert_eq!(dup[0].0, 1001);
}

#[test]
fn recur_defs_round_trip() {
    let mut conn = test_conn();
    let defs = vec![
        RecurDef {
            id: 3001,
            memo: "주간 정례보고".into(),
            freq: "weekly".into(),
            dow: vec![1, 3, 5],
            time: RecurTime { hh: 9, mm: 30 },
            next: "2026-07-13T09:30:00.000Z".into(),
            paused: false,
        },
        RecurDef {
            id: 3002,
            memo: "매일 야근 체크".into(),
            freq: "daily".into(),
            dow: vec![],
            time: RecurTime { hh: 18, mm: 0 },
            next: "2026-07-11T18:00:00.000Z".into(),
            paused: true,
        },
    ];
    recur_defs::save_recur_defs(&mut conn, &defs).unwrap();
    let loaded = recur_defs::load_recur_defs(&conn).unwrap();
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].id, 3001);
    assert_eq!(loaded[0].freq, "weekly");
    assert_eq!(loaded[0].dow, vec![1, 3, 5]);
    assert_eq!(loaded[0].time.hh, 9);
    assert_eq!(loaded[0].time.mm, 30);
    assert_eq!(loaded[0].next, "2026-07-13T09:30:00.000Z");
    assert!(!loaded[0].paused);
    // daily def: empty dow, paused flag preserved
    assert_eq!(loaded[1].dow, Vec::<i64>::new());
    assert!(loaded[1].paused);
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

    let defs = vec![RecurDef {
        id: 3001,
        memo: "정례보고".into(),
        freq: "weekly".into(),
        dow: vec![1],
        time: RecurTime { hh: 9, mm: 0 },
        next: "2026-07-13T09:00:00.000Z".into(),
        paused: false,
    }];
    recur_defs::save_recur_defs(&mut conn, &defs).unwrap();

    let payload = backup::export_payload(&conn).unwrap();
    assert_eq!(payload.v, backup::BACKUP_VERSION);
    assert_eq!(payload.items.len(), 2);
    assert_eq!(payload.recur_defs.len(), 1);

    // Simulate importing into a fresh database, as would happen migrating
    // from the legacy HTML app's JSON backup.
    let mut fresh = test_conn();
    backup::import_payload(&mut fresh, payload).unwrap();
    let restored = items::load_items(&fresh).unwrap();
    assert_eq!(restored.len(), 2);
    // v2.5.0 담당자: JSON 백업 내보내기→복원에서도 owner가 보존된다.
    assert_eq!(restored[0].owner, "박주무관");
    assert_eq!(restored[0].subs[0].owner, "김담당");
    assert_eq!(restored[1].owner, "");
    let restored_settings = settings::load_settings(&fresh).unwrap();
    assert_eq!(
        restored_settings.get("alarmOn"),
        Some(&serde_json::Value::Bool(false))
    );
    // Recurrence definitions ride along in the JSON backup for free.
    let restored_defs = recur_defs::load_recur_defs(&fresh).unwrap();
    assert_eq!(restored_defs.len(), 1);
    assert_eq!(restored_defs[0].id, 3001);
    assert_eq!(restored_defs[0].next, "2026-07-13T09:00:00.000Z");
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
fn apply_pending_import_replaces_db_and_backs_up_the_old_one() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_pending_import_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);

    // Existing live DB with 2 items.
    {
        let mut conn = super::open(&db_path).unwrap();
        items::save_items(&mut conn, &sample_items()).unwrap();
    }

    // Stage a different, single-item DB as a pending import (mirrors what
    // commands::import_backup_file does: copy the picked file to
    // pending_import_path, never touching db_path directly).
    {
        let staging_dir = dir.join("staging");
        let staged_path = staging_dir.join("picked.sqlite");
        let mut staged = super::open(&staged_path).unwrap();
        items::save_items(&mut staged, &[sample_items().remove(1)]).unwrap();
        drop(staged);
        std::fs::copy(&staged_path, super::pending_import_path(&db_path)).unwrap();
    }

    assert!(super::pending_import_path(&db_path).exists());

    let applied = super::apply_pending_import(&db_path, &backups_dir).unwrap();
    assert!(applied);
    assert!(!super::pending_import_path(&db_path).exists(), "staging file must be consumed");

    // db_path now holds the imported (single-item) data...
    let conn = super::open(&db_path).unwrap();
    let loaded = items::load_items(&conn).unwrap();
    assert_eq!(loaded.len(), 1);

    // ...and the pre-import state was preserved as a backup, not lost.
    let preimport_backups: Vec<_> = std::fs::read_dir(&backups_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("wmhh_preimport_"))
        .collect();
    assert_eq!(preimport_backups.len(), 1);

    // Calling again with nothing staged must be a harmless no-op.
    let applied_again = super::apply_pending_import(&db_path, &backups_dir).unwrap();
    assert!(!applied_again);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn open_with_recovery_happy_path_has_no_note() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_recovery_ok_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);

    let (_conn, note) = super::open_with_recovery(&db_path, &backups_dir).unwrap();
    assert!(note.is_none());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn open_with_recovery_restores_from_newest_backup_when_primary_is_corrupt() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_recovery_backup_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);

    // Seed a real, valid backup with known data.
    {
        let mut good = super::open(&db_path).unwrap();
        items::save_items(&mut good, &sample_items()).unwrap();
        let stamp = super::now_stamp(&good).unwrap();
        drop(good);
        super::rotate_backup(&db_path, &backups_dir, &stamp, 20).unwrap();
    }

    // Corrupt the primary file (valid header, garbage body — the same
    // "opens but isn't usable" shape as a real-world corruption).
    std::fs::write(&db_path, b"not actually a sqlite file, just garbage bytes").unwrap();

    let (conn, note) = super::open_with_recovery(&db_path, &backups_dir).unwrap();
    assert!(note.is_some(), "recovery should report what happened");
    let restored = items::load_items(&conn).unwrap();
    assert_eq!(restored.len(), 2, "should recover the backed-up data, not start empty");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn open_with_recovery_quarantines_and_starts_fresh_when_no_backup_exists() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_recovery_fresh_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups"); // deliberately never created — no backups
    let _ = std::fs::remove_dir_all(&dir);

    std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();
    std::fs::write(&db_path, b"garbage, not a database, and no backup to fall back to").unwrap();

    let (conn, note) = super::open_with_recovery(&db_path, &backups_dir).unwrap();
    assert!(note.is_some());
    let items = items::load_items(&conn).unwrap();
    assert_eq!(items.len(), 0, "should start fresh, not crash");

    // The broken original must be preserved, not deleted.
    let quarantined: Vec<_> = std::fs::read_dir(db_path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("wmhh.broken-"))
        .collect();
    assert_eq!(quarantined.len(), 1, "the broken file should be renamed aside, not lost");

    let _ = std::fs::remove_dir_all(&dir);
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
fn throttled_rotation_skips_when_recent_backup_exists() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_throttle_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);
    let _conn = super::open(&db_path).unwrap();

    let interval = std::time::Duration::from_secs(60);
    // First rotation: no backups exist yet, must write.
    assert!(super::rotate_backup_throttled(&db_path, &backups_dir, "0001", 20, interval).unwrap());
    // Immediately after: newest backup is seconds old, must skip.
    assert!(!super::rotate_backup_throttled(&db_path, &backups_dir, "0002", 20, interval).unwrap());
    let count = std::fs::read_dir(&backups_dir).unwrap().count();
    assert_eq!(count, 1, "second rotation within the interval must not add a file");
    // Zero interval: must write again.
    assert!(super::rotate_backup_throttled(&db_path, &backups_dir, "0003", 20, std::time::Duration::ZERO).unwrap());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn pruning_protects_first_backup_of_each_day() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_daily_{}", std::process::id()));
    let db_path = dir.join("data").join("test.sqlite");
    let backups_dir = dir.join("backups");
    let _ = std::fs::remove_dir_all(&dir);
    let _conn = super::open(&db_path).unwrap();
    std::fs::create_dir_all(&backups_dir).unwrap();

    // Simulate an old day's backups plus a burst of 5 today, keep=3.
    // Without daily protection, the old day would be pruned away entirely.
    for stamp in ["20260701_090000", "20260701_180000",
                  "20260710_100000", "20260710_100100", "20260710_100200",
                  "20260710_100300", "20260710_100400"] {
        std::fs::copy(&db_path, backups_dir.join(format!("wmhh_{stamp}.sqlite"))).unwrap();
    }
    super::rotate_backup(&db_path, &backups_dir, "20260710_100500", 3).unwrap();

    let names: Vec<String> = std::fs::read_dir(&backups_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.contains(&"wmhh_20260701_090000.sqlite".to_string()),
        "the first backup of the older day must survive pruning; got {names:?}"
    );
    assert!(
        names.contains(&"wmhh_20260710_100000.sqlite".to_string()),
        "the first backup of today must survive pruning; got {names:?}"
    );
    assert!(
        names.contains(&"wmhh_20260710_100500.sqlite".to_string()),
        "the newest backup must survive; got {names:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn apply_pending_move_carries_db_backups_and_staged_import() {
    let dir = std::env::temp_dir().join(format!("wmhh_test_move_{}", std::process::id()));
    let old_base = dir.join("old");
    let new_base = dir.join("new");
    let _ = std::fs::remove_dir_all(&dir);

    let old_db = old_base.join("data").join("wmhh.sqlite");
    {
        let mut conn = super::open(&old_db).unwrap();
        items::save_items(&mut conn, &sample_items()).unwrap();
        let stamp = super::now_stamp(&conn).unwrap();
        drop(conn);
        super::rotate_backup(&old_db, &old_base.join("backups"), &stamp, 20).unwrap();
    }
    // A staged import waiting at the old location must travel too.
    std::fs::write(super::pending_import_path(&old_db), b"staged").unwrap();

    super::apply_pending_move(&old_base, &new_base).unwrap();

    let new_db = new_base.join("data").join("wmhh.sqlite");
    let conn = super::open(&new_db).unwrap();
    assert_eq!(items::load_items(&conn).unwrap().len(), 2, "data must arrive at the new location");
    assert_eq!(
        std::fs::read_dir(new_base.join("backups")).unwrap().count(),
        1,
        "backups must be carried over"
    );
    assert!(super::pending_import_path(&new_db).exists(), "staged import must be carried over");
    assert!(old_db.exists(), "the old copy stays behind as a safety net (never deleted)");

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

#[test]
fn now_stamp_and_fs_stamp_share_format_and_timezone() {
    let conn = test_conn();
    let a = super::now_stamp(&conn).unwrap();
    let b = super::fs_stamp();
    // 포맷: YYYYMMDD_HHMMSS — 사전순==시간순의 전제
    for s in [&a, &b] {
        assert_eq!(s.len(), 15, "stamp {s}");
        assert!(s.chars().enumerate().all(|(i, c)| if i == 8 { c == '_' } else { c.is_ascii_digit() }), "stamp {s}");
    }
    // 같은 시각대(localtime)여야 함 — 한쪽만 UTC면 KST에서 9시간 어긋난다.
    // 분 접두어(YYYYMMDD_HHMM)까지 비교; 분 경계 직전 호출이면 1회 재시도.
    let same_minute = |x: &str, y: &str| x[..13] == y[..13];
    if !same_minute(&a, &b) {
        let a2 = super::now_stamp(&conn).unwrap();
        let b2 = super::fs_stamp();
        assert!(same_minute(&a2, &b2), "now_stamp {a2} vs fs_stamp {b2} — 시각대 불일치");
    }
}
