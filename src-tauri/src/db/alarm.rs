use super::model::{AlarmMap, AlarmState};

/// Encode the alarm state stored under `key` (if any) into the single TEXT
/// column that backs it ("true"/"false" for an acknowledged alarm, or the
/// snooze-until epoch-ms as a decimal string). Mirrors the JS shapes
/// `obj.al[key] = true` / `obj.al[key] = Date.now() + 6e5`.
pub fn encode(al: &AlarmMap, key: &str) -> Option<String> {
    al.get(key).map(|state| match state {
        AlarmState::Fired(b) => b.to_string(),
        AlarmState::SnoozeUntil(ms) => ms.to_string(),
    })
}

/// Inverse of `encode`: reconstructs a one-entry AlarmMap from the stored
/// column text, or an empty map when the column is NULL/absent.
pub fn decode(text: Option<&str>, key: &str) -> AlarmMap {
    let mut map = AlarmMap::new();
    if let Some(s) = text {
        let state = match s {
            "true" => AlarmState::Fired(true),
            "false" => AlarmState::Fired(false),
            other => match other.parse::<i64>() {
                Ok(ms) => AlarmState::SnoozeUntil(ms),
                // v2.5.11: 손상/미지의 값은 '미확인(Fired(false))'으로 — Fired(true)로 두면
                // 알람이 이미 확인된 것으로 취급돼 다시 울리지 않는다(안전방향은 '울리게').
                Err(_) => AlarmState::Fired(false),
            },
        };
        map.insert(key.to_string(), state);
    }
    map
}
