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
/// creates `<location>/뭐하려했더라_데이터/` and points config.json at it,
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

/* (v2.5.5 제거) open_main_maximized — 캡처 창 'Ctrl 단독 → 최대화' 기능과 함께 삭제. */

/// 작업표시줄 알람 표시(v2.5.3) — 알람이 울리면 on=true로 호출되어
/// Windows 작업표시줄 아이콘을 깜빡이고(FlashWindow, 포커스를 받으면 OS가 멈춤)
/// 아이콘 위에 빨간 점 오버레이 배지를 얹는다. 사용자가 알람을 확인(on=false)하면
/// 배지를 제거한다. 오버레이는 Windows 전용 API라 실패해도 조용히 무시.
#[tauri::command]
pub fn alarm_attention(app: AppHandle, on: bool) -> Result<(), String> {
    let Some(win) = app.get_webview_window("main") else {
        return Ok(());
    };
    if on {
        let _ = win.request_user_attention(Some(tauri::UserAttentionType::Critical));
        // set_overlay_icon 은 Windows 전용 API — 다른 OS에선 존재하지 않아 컴파일이 깨진다.
        // cfg(windows) 로 게이트해 리눅스/맥에서도 crate가 빌드·테스트되게 한다(v2.5.11).
        #[cfg(windows)]
        let _ = win.set_overlay_icon(Some(red_dot_icon()));
    } else {
        let _ = win.request_user_attention(None);
        #[cfg(windows)]
        let _ = win.set_overlay_icon(None);
    }
    Ok(())
}

/// 32×32 빨간 원 오버레이(가장자리 1px 안티앨리어스) — PNG 자산 없이 런타임 생성.
/// Windows 전용(set_overlay_icon 에서만 사용) — 다른 OS에선 미사용 경고를 피하려 게이트.
#[cfg(windows)]
fn red_dot_icon() -> tauri::image::Image<'static> {
    const S: u32 = 32;
    let (cx, cy, r) = (15.5f32, 15.5f32, 14.0f32);
    let mut px = Vec::with_capacity((S * S * 4) as usize);
    for y in 0..S {
        for x in 0..S {
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let a = ((r - d + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            px.extend_from_slice(&[0xE8, 0x11, 0x23, a]); // Windows 경고 빨강 (#E81123)
        }
    }
    tauri::image::Image::new_owned(px, S, S)
}

/// 미니 캡처 창 전역 단축키 — v2.31부터 이 값으로 고정(설정 UI 없음).
/// (Ctrl+Space 는 한/영 전환, Alt+Space 는 시스템 메뉴와 충돌해서 피했다.)
pub const CAPTURE_SHORTCUT: &str = "Ctrl+Alt+Space";

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
        let sz = win.outer_size().unwrap_or(tauri::PhysicalSize::new(560, 128));
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

/// 시작 시 고정 단축키(CAPTURE_SHORTCUT) 등록 — lib.rs setup 전용.
pub fn register_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let sc: Shortcut = shortcut.parse().map_err(to_err)?;
    app.global_shortcut()
        .on_shortcut(sc, capture_hotkey_handler)
        .map_err(to_err)
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

/* ===== v3.1.0 미니 캡처 검색 모드 + 설정 ===== */

/// 캡처 창 빠른 검색의 업무 쪽 결과 한 건.
#[derive(serde::Serialize)]
pub struct QuickHit {
    pub id: i64,
    pub memo: String,
    pub done: bool,
}

/// 미니 캡처 창(메인 모듈 접근 불가)의 업무 검색 — 읽기 전용이므로 무결성
/// 게이트에 걸려도 빈 목록만 돌려준다 (검색이 복구를 방해할 이유가 없다).
#[tauri::command]
pub fn quick_search(state: State<AppDb>, query: String) -> Result<Vec<QuickHit>, String> {
    let q = query.trim();
    if q.is_empty() || !state.integrity_ok.load(Ordering::Relaxed) {
        return Ok(vec![]);
    }
    let conn = state.conn.lock().map_err(to_err)?;
    Ok(db::items::quick_search(&conn, q, 15)
        .map_err(to_err)?
        .into_iter()
        .map(|(id, memo, done)| QuickHit { id, memo, done })
        .collect())
}

/// 화면 확대 배율(%) 읽기 — 캡처 웹뷰 전용 (v2.6.0).
/// 캡처 창은 메인 앱 모듈(store.js)을 못 쓰므로 settings 를 직접 읽을 수 없다.
/// 값이 없거나 손상됐으면 100(등배)으로 떨어진다.
#[tauri::command]
pub fn get_ui_scale(state: State<AppDb>) -> Result<u32, String> {
    let conn = state.conn.lock().map_err(to_err)?;
    let settings = db::settings::load_settings(&conn).map_err(to_err)?;
    Ok(settings
        .get("uiScale")
        .and_then(|v| v.as_u64())
        .unwrap_or(100)
        .clamp(100, 130) as u32)
}

/// 캡처 창 크기 전환 (메모 모드 64px ↔ 검색 모드 확장). 웹뷰 쪽에 창 크기
/// 권한을 열어주는 대신 커맨드 하나로 좁게 노출한다.
/// v2.6.0: `scale`(%)을 받아 창 자체도 같은 배율로 키운다 — 내용만 확대하면
/// 네이티브 창 크기는 그대로라 글자가 창 밖으로 잘린다.
#[tauri::command]
pub fn resize_capture(app: AppHandle, height: u32, scale: Option<u32>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("capture") {
        let s = scale.unwrap_or(100).clamp(100, 130) as f64 / 100.0;
        let h = height.clamp(64, 640) as f64 * s;
        win.set_size(tauri::LogicalSize::new(560.0 * s, h)).map_err(to_err)?;
    }
    Ok(())
}

/* ===== v3.0.0 파일 링크 ===== */

/// 파일 링크용 네이티브 파일 선택창 — 선택한 파일의 절대경로만 돌려준다
/// (복사·이동 없음: 링크는 경로 문자열일 뿐이다).
#[tauri::command]
pub async fn pick_file_path(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    Ok(Some(picked.into_path().map_err(to_err)?.to_string_lossy().into_owned()))
}

/// 카드의 파일 링크 클릭 → 기본 연결 프로그램으로 파일 열기.
#[tauri::command]
pub fn open_file_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(&path, None::<String>).map_err(to_err)
}

/// 파일 링크의 📂 버튼 → 탐색기에서 해당 파일이 선택된 폴더 열기.
#[tauri::command]
pub fn reveal_file_path(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(&path).map_err(to_err)
}

