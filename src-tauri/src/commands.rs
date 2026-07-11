use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::config::{self, AppConfig};
use crate::db;
use crate::db::model::{AppState, BackupPayload, FieldDef, Item, Preset, Settings};
use crate::AppDb;

/// How many rotated .sqlite backups to keep (see db::rotate_backup).
const BACKUP_KEEP: usize = 20;

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Write-command gate: a DB that failed the startup integrity check must
/// never be overwritten by the delete+reinsert save path — that would turn
/// recoverable corruption into a permanent one. `backup_import` is exempt
/// (restoring is the recovery path and re-arms the flag); `backup_export`
/// is exempt too (read-only — let the user salvage what still reads).
fn ensure_integrity(state: &State<AppDb>) -> Result<(), String> {
    if !state.integrity_ok.load(Ordering::Relaxed) {
        return Err(
            "데이터베이스 무결성 검사에 실패한 상태라 저장할 수 없습니다. 백업에서 복원 후 다시 시도해주세요."
                .into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn load_all(state: State<AppDb>) -> Result<AppState, String> {
    if !state.integrity_ok.load(Ordering::Relaxed) {
        return Err(
            "데이터베이스 무결성 검사에 실패했습니다. 자동 백업 또는 JSON 백업에서 복원이 필요합니다."
                .into(),
        );
    }
    let conn = state.conn.lock().map_err(to_err)?;
    db::backup::load_app_state(&conn).map_err(to_err)
}

/// Minimum age of the newest backup before an after-save rotation writes
/// another one. Saves fire on every user action, so without this the whole
/// rotation window collapses into a few minutes of one editing session.
const BACKUP_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30 * 60);

#[tauri::command]
pub fn save_all(state: State<AppDb>, items: Vec<Item>) -> Result<(), String> {
    ensure_integrity(&state)?;
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::items::save_items(&mut conn, &items).map_err(to_err)?;
    let stamp = db::now_stamp(&conn).map_err(to_err)?;
    // Best-effort: a failed backup rotation must not fail the save itself
    // (the save already committed by this point). The copy must run while
    // the connection lock is still held — every write command serializes
    // on this Mutex, so holding it guarantees no other command is
    // mid-transaction and the snapshot can't be torn.
    if let Err(e) = db::rotate_backup_throttled(
        &state.db_path,
        &state.backups_dir,
        &stamp,
        BACKUP_KEEP,
        BACKUP_MIN_INTERVAL,
    ) {
        eprintln!("backup rotation failed: {e}");
    }
    drop(conn);
    Ok(())
}

#[tauri::command]
pub fn save_fields(state: State<AppDb>, fields: Vec<FieldDef>) -> Result<(), String> {
    ensure_integrity(&state)?;
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::fields::save_fields(&mut conn, &fields).map_err(to_err)
}

#[tauri::command]
pub fn save_presets(state: State<AppDb>, presets: Vec<Preset>) -> Result<(), String> {
    ensure_integrity(&state)?;
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::presets::save_presets(&mut conn, &presets).map_err(to_err)
}

#[tauri::command]
pub fn save_id_kinds(state: State<AppDb>, id_kinds: Vec<String>) -> Result<(), String> {
    ensure_integrity(&state)?;
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::id_kinds::save_id_kinds(&mut conn, &id_kinds).map_err(to_err)
}

#[tauri::command]
pub fn save_settings(state: State<AppDb>, settings: Settings) -> Result<(), String> {
    ensure_integrity(&state)?;
    let mut conn = state.conn.lock().map_err(to_err)?;
    db::settings::save_settings(&mut conn, &settings).map_err(to_err)
}

#[tauri::command]
pub fn backup_export(state: State<AppDb>) -> Result<BackupPayload, String> {
    let conn = state.conn.lock().map_err(to_err)?;
    db::backup::export_payload(&conn).map_err(to_err)
}

#[tauri::command]
pub fn backup_import(state: State<AppDb>, payload: BackupPayload) -> Result<(), String> {
    // Safety net before a destructive whole-dataset overwrite: snapshot the
    // live file under a distinguishable name before touching anything.
    // The copy runs while the connection lock is held (same lock we then
    // import under) so no concurrent write can tear the snapshot.
    let mut conn = state.conn.lock().map_err(to_err)?;
    let stamp = db::now_stamp(&conn).map_err(to_err)?;
    db::rotate_backup(
        &state.db_path,
        &state.backups_dir,
        &format!("prerestore_{stamp}"),
        BACKUP_KEEP,
    )
    .map_err(to_err)?;
    db::backup::import_payload(&mut conn, payload).map_err(to_err)?;
    // A successful full restore supersedes whatever the startup integrity
    // check concluded — without this, an app whose DB was flagged bad at
    // launch would keep rejecting load_all even after the user restored a
    // good backup, forcing a pointless extra restart.
    state.integrity_ok.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn get_data_dir(state: State<AppDb>) -> String {
    state.base_dir.to_string_lossy().into_owned()
}

use crate::config::DATA_FOLDER_NAME;

/// Opens a native folder picker for a *location*; if the user chooses one,
/// creates `<location>/뭐해야했더라_데이터/` and points config.json at it,
/// with `pending_move_from` recording where the data still physically is.
///
/// Deliberately does NOT copy any data here. An earlier version copied at
/// choose time, which opened a silent data-loss window: if the user
/// declined the immediate restart and kept working, every subsequent save
/// still went to the OLD location, and the stale snapshot at the new
/// location won at next launch. The copy now happens at the start of the
/// next launch (`db::apply_pending_move`, wired in lib.rs), which by
/// construction includes everything saved up to shutdown.
#[tauri::command]
pub async fn choose_data_dir(app: AppHandle, state: State<'_, AppDb>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let new_base = picked.into_path().map_err(to_err)?.join(DATA_FOLDER_NAME);
    if new_base == state.base_dir {
        return Ok(Some(new_base.to_string_lossy().into_owned())); // already there — nothing to do
    }

    // Create the folder now so the user sees it appear where they pointed,
    // and so an unwritable location fails HERE (with a clear error) rather
    // than at next launch.
    std::fs::create_dir_all(new_base.join("data")).map_err(to_err)?;

    config::save(
        &state.app_config_dir,
        &AppConfig {
            data_dir: Some(new_base.to_string_lossy().into_owned()),
            pending_move_from: Some(state.base_dir.to_string_lossy().into_owned()),
        },
    )?;

    Ok(Some(new_base.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.request_restart();
}

/// Brings the main window to the foreground even if another window
/// currently has focus — used when an alarm fires so the user notices it
/// instead of relying on browser-style window.focus(), which can't
/// actually steal focus from other applications.
#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.unminimize().map_err(to_err)?;
        win.show().map_err(to_err)?;
        win.set_focus().map_err(to_err)?;
    }
    Ok(())
}

/// JS 쪽 DEFAULT_SETTINGS.captureShortcut 과 문자열이 반드시 동일해야 한다 —
/// 새 DB에는 settings 행이 없어 양쪽이 각자 이 기본값을 파생하기 때문.
/// (Ctrl+Space 는 한/영 전환, Alt+Space 는 시스템 메뉴와 충돌해서 피했다.)
pub const DEFAULT_CAPTURE_SHORTCUT: &str = "Ctrl+Alt+Space";

/// 전역 단축키 핸들러 본체 — 메인 창은 절대 건드리지 않는다(사용자 필수 요구:
/// 다른 앱 작업 중 미니 팝업만 비침습적으로 떴다가 사라져야 한다).
/// 이미 보이면 숨김(토글), 아니면 커서가 있는 모니터 중앙 상단에 표시.
pub fn show_capture_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("capture") else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let sz = win.outer_size().unwrap_or(tauri::PhysicalSize::new(560, 64));
        let x = m.position().x + (m.size().width as i32 - sz.width as i32) / 2;
        let y = m.position().y + (m.size().height as f64 * 0.2) as i32;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
    let _ = win.show();
    let _ = win.set_focus();
}

fn capture_hotkey_handler(app: &AppHandle, _sc: &Shortcut, ev: ShortcutEvent) {
    if ev.state() == ShortcutState::Pressed {
        show_capture_window(app);
    }
}

/// 등록만 담당 — setup(시작 시)과 set_capture_shortcut(변경 시)이 공용.
pub fn register_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let sc: Shortcut = shortcut.parse().map_err(to_err)?;
    app.global_shortcut()
        .on_shortcut(sc, capture_hotkey_handler)
        .map_err(to_err)
}

/// 캡처 단축키 라이브 재등록. 실패 시 이전 단축키를 복구(롤백)하고 Err —
/// 프론트는 Err를 받으면 설정값을 바꾸지 않는다.
#[tauri::command]
pub fn set_capture_shortcut(
    app: AppHandle,
    cur: State<crate::CaptureShortcut>,
    shortcut: String,
) -> Result<(), String> {
    let mut cur = cur.0.lock().map_err(to_err)?;
    // 파싱 검증을 먼저 — 기존 등록을 풀기 전에 실패해야 롤백조차 필요 없다
    let _: Shortcut = shortcut
        .parse()
        .map_err(|e| format!("단축키 형식 오류: {e}"))?;
    let gs = app.global_shortcut();
    if let Ok(old) = cur.parse::<Shortcut>() {
        let _ = gs.unregister(old); // 시작 시 등록 실패했던 유령 값이면 조용히 무시
    }
    if let Err(e) = register_capture_shortcut(&app, &shortcut) {
        let _ = register_capture_shortcut(&app, &cur); // 롤백: 이전 단축키 복구
        return Err(format!("단축키를 등록할 수 없습니다: {e}"));
    }
    *cur = shortcut;
    Ok(())
}

/// Windows 시작 시 자동 실행 켜기/끄기 (HKCU Run 키 — 관리자 권한 불필요).
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(to_err)
    } else if al.is_enabled().unwrap_or(false) {
        al.disable().map_err(to_err)
    } else {
        Ok(()) // 이미 꺼져 있음 — 멱등
    }
}

/// Opens a native "save as" dialog and writes `content` to wherever the
/// user picks. Returns false if the user cancelled.
///
/// The frontend used to trigger downloads by clicking a hidden
/// `<a download>` link to a blob: URL — that's a browser trick, and a Tauri
/// webview has no download manager to catch it, so it silently did nothing
/// (both the JSON backup and the XLSX export were affected). Routing
/// through a real native save dialog is the actual fix.
#[tauri::command]
pub async fn save_text_file(app: AppHandle, suggested_name: String, content: String) -> Result<bool, String> {
    let Some(path) = app.dialog().file().set_file_name(&suggested_name).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(to_err)?;
    std::fs::write(path, content).map_err(to_err)?;
    Ok(true)
}

/// Same as `save_text_file` but for binary output (XLSX).
#[tauri::command]
pub async fn save_binary_file(app: AppHandle, suggested_name: String, data: Vec<u8>) -> Result<bool, String> {
    let Some(path) = app.dialog().file().set_file_name(&suggested_name).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(to_err)?;
    std::fs::write(path, data).map_err(to_err)?;
    Ok(true)
}

/// What `import_backup_file` picked and did.
#[derive(serde::Serialize)]
#[serde(tag = "kind")]
pub enum ImportResult {
    Cancelled,
    /// A .json backup was picked — its raw text is handed back to the
    /// frontend, which already knows how to parse/reconcile/persist it
    /// (unchanged from before; no restart needed, it goes through the
    /// normal save_all path).
    Json { content: String },
    /// A .sqlite/.db file was picked, validated, and staged (NOT yet
    /// applied — that happens at next launch). `items` lets the frontend
    /// show the same "N건을 불러옵니다" confirmation as the JSON path;
    /// cancelling calls `cancel_pending_import` to discard the staging.
    Db { items: i64 },
}

/// One unified "불러오기" entry point for both backup formats: opens a
/// single native file picker accepting `.json` or `.sqlite`/`.db`, and
/// dispatches based on the picked file's extension.
#[tauri::command]
pub async fn import_backup_file(app: AppHandle, state: State<'_, AppDb>) -> Result<ImportResult, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("백업 파일 (JSON 또는 DB)", &["json", "sqlite", "db"])
        .blocking_pick_file()
    else {
        return Ok(ImportResult::Cancelled);
    };
    let picked_path = picked.into_path().map_err(to_err)?;
    let ext = picked_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "json" {
        let content = std::fs::read_to_string(&picked_path).map_err(to_err)?;
        return Ok(ImportResult::Json { content });
    }

    // .sqlite / .db path — validate before touching anything live: must
    // actually open, pass its own integrity check, and look like one of
    // our databases. The error text matters here: a rejected pick is the
    // user's FIRST contact with a corrupt old file, and a raw English
    // "file is not a database" reads like the app itself broke again.
    // Say clearly that (a) the picked file is the problem and (b) nothing
    // was changed.
    const PICK_BAD: &str =
        "선택한 파일이 손상되어 있어 가져올 수 없습니다.\n(현재 데이터는 변경되지 않았습니다 — 다른 백업 파일을 선택해주세요.)";
    let check_conn = rusqlite::Connection::open(&picked_path)
        .map_err(|e| format!("{PICK_BAD}\n\n상세: {e}"))?;
    let integrity: String = check_conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("{PICK_BAD}\n\n상세: {e}"))?;
    if integrity != "ok" {
        return Err(format!("{PICK_BAD}\n\n무결성 검사 결과: {integrity}"));
    }
    let has_items: i64 = check_conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'",
            [],
            |r| r.get(0),
        )
        .map_err(to_err)?;
    if has_items == 0 {
        return Err("선택한 파일이 이 프로그램의 데이터베이스 형식이 아닙니다.".into());
    }
    let item_count: i64 = check_conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .map_err(to_err)?;
    drop(check_conn);

    // Do NOT copy over state.db_path here — this process's own AppDb.conn
    // is a live, open connection to that exact file. Overwriting a
    // SQLite file's bytes out from under a connection that still has it
    // open (even just idle, even on Windows where the raw byte-copy
    // itself "succeeds") reliably left the file unreadable on next
    // launch — every import ended up "recovered from backup" instead of
    // actually applying, because the stale open connection's own
    // teardown corrupted what we'd just written. Instead, stage the
    // picked file next to the real one; `db::apply_pending_import` moves
    // it into place at the start of the *next* process's startup, before
    // any connection has been opened at all.
    std::fs::copy(&picked_path, db::pending_import_path(&state.db_path)).map_err(to_err)?;
    Ok(ImportResult::Db { items: item_count })
}

/// Discards a staged DB import (the user declined the final confirmation).
/// Idempotent: fine to call when nothing is staged.
#[tauri::command]
pub fn cancel_pending_import(state: State<AppDb>) -> Result<(), String> {
    let pending = db::pending_import_path(&state.db_path);
    if pending.exists() {
        std::fs::remove_file(&pending).map_err(to_err)?;
    }
    Ok(())
}
