use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Alarm-fired state for a single key (e.g. "due" on an item, "mid" on a
/// subtask). Mirrors the JS shape: `true` once acknowledged, or an epoch-ms
/// number while snoozed. Untagged so it round-trips as a bare JSON bool or
/// number, matching what checkAlarms() in the existing frontend expects.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AlarmState {
    Fired(bool),
    SnoozeUntil(i64),
}

pub type AlarmMap = HashMap<String, AlarmState>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Contact {
    #[serde(default)]
    pub who: String,
    #[serde(default)]
    pub org: String,
    #[serde(default)]
    pub phone: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Identifier {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub val: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubTask {
    pub id: i64,
    #[serde(default)]
    pub title: String,
    /// v2.5.0 담당자 (자유 텍스트, "" = 본인).
    #[serde(default)]
    pub owner: String,
    /// ISO datetime string, or "" when unset — kept as a plain string to
    /// match the existing frontend's date handling verbatim.
    #[serde(default)]
    pub mid: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub al: AlarmMap,
}

/// Time-of-day for a recurrence's spawned occurrences (its due time).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecurTime {
    #[serde(default)]
    pub hh: i64,
    #[serde(default)]
    pub mm: i64,
}

/// A recurrence definition ("정기"), v2.3. Lives off the board and spawns a
/// normal item when its next occurrence's day arrives (see 002_recurrence.sql
/// and the JS `reconcileRecur`). `freq` is "daily"|"weekly"|"monthly"; `dow`
/// (0=Sun..6=Sat) applies to weekly only; `next` is the ISO datetime of the
/// next occurrence to spawn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurDef {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub memo: String,
    // v2.5.11: freq/time 에 #[serde(default)] — 레거시/부분 백업의 recurDef 한 건이
    // 필드 누락으로 전체 복원을 거부하던 문제 방지(정기함은 제거됐고 이 데이터는 보존용 pass-through).
    #[serde(default)]
    pub freq: String,
    #[serde(default)]
    pub dow: Vec<i64>,
    #[serde(default)]
    pub time: RecurTime,
    #[serde(default)]
    pub next: String,
    #[serde(default)]
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: i64,
    #[serde(default)]
    pub memo: String,
    /// v2.5.0 담당자 (자유 텍스트, "" = 본인) — 시간·담당자 보드 모드용.
    #[serde(default)]
    pub owner: String,
    /// Field-key -> value. Always the two builtin keys ("received","due")
    /// plus whatever custom fields the user defined; values are always
    /// plain strings on the wire (dates as ISO strings).
    #[serde(default)]
    pub f: HashMap<String, String>,
    #[serde(default)]
    pub contacts: Vec<Contact>,
    #[serde(default)]
    pub ids: Vec<Identifier>,
    #[serde(default)]
    pub subs: Vec<SubTask>,
    /// Absolute file paths linked to this item (v3.0.0 파일 링크). Plain
    /// strings, order-preserving; pre-v3 backups simply lack the key and
    /// default to empty, and the legacy app ignores it on import.
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub done: bool,
    /// Epoch-ms when marked done (null when not done / re-opened). Used by
    /// the completed-items view to sort most-recently-done first.
    #[serde(rename = "doneAt", default)]
    pub done_at: Option<i64>,
    #[serde(default)]
    pub staged: bool,
    #[serde(default)]
    pub al: AlarmMap,
    /// Soft link to the recur_def that spawned this item, or None for a
    /// hand-created item. Skipped from the wire when absent so ordinary items
    /// round-trip unchanged.
    #[serde(rename = "recurId", default, skip_serializing_if = "Option::is_none")]
    pub recur_id: Option<i64>,
    /// v3.1.0 주기 업무: recurrence definition owned by the item itself
    /// ({type,dow/days,time} — see src/recur.js). Opaque JSON to Rust; the
    /// frontend owns the semantics. Stored as JSON text in items.recur.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recur: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDef {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub on: bool,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub sum: String,
    #[serde(default)]
    pub subs: Vec<String>,
}

/// Free-form settings bag (currently just {alarmOn:bool}), kept generic so
/// new settings don't require a schema/struct change.
pub type Settings = serde_json::Map<String, serde_json::Value>;

/// Full application state as handed to/from the frontend in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppState {
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub presets: Vec<Preset>,
    #[serde(rename = "idKinds", default)]
    pub id_kinds: Vec<String>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(rename = "recurDefs", default)]
    pub recur_defs: Vec<RecurDef>,
}

/// Same shape as the legacy HTML app's `backupPayload()` JSON, so backups
/// exported from the old app import unchanged, and vice versa.
/// Every field defaults: older exports (pre-v5) lack idKinds/settings, and
/// a restore must not be rejected wholesale over an absent optional
/// section — the frontend fills sensible values for whatever's missing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPayload {
    #[serde(default)]
    pub v: i32,
    #[serde(default)]
    pub exported: String,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub presets: Vec<Preset>,
    #[serde(rename = "idKinds", default)]
    pub id_kinds: Vec<String>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(rename = "recurDefs", default)]
    pub recur_defs: Vec<RecurDef>,
}
