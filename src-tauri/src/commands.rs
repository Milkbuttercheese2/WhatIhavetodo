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

/// 캡처 창 크기 전환 (메모 모드 64px ↔ 검색 모드 확장). 웹뷰 쪽에 창 크기
/// 권한을 열어주는 대신 커맨드 하나로 좁게 노출한다.
#[tauri::command]
pub fn resize_capture(app: AppHandle, height: u32) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("capture") {
        let h = height.clamp(64, 640);
        win.set_size(tauri::LogicalSize::new(560.0, h as f64)).map_err(to_err)?;
    }
    Ok(())
}

/// 설정만 가볍게 읽기 — 캡처 웹뷰가 Everything 사용 여부/포트를 알기 위해
/// 쓴다 (load_all은 아이템 전체를 끌고 오고 무결성 게이트도 걸린다).
#[tauri::command]
pub fn load_settings_only(state: State<AppDb>) -> Result<Settings, String> {
    let conn = state.conn.lock().map_err(to_err)?;
    db::settings::load_settings(&conn).map_err(to_err)
}

/// '실행 시 Everything 자동 실행' — settings.everythingPath(선택)를 먼저,
/// 없으면 일반 설치 경로들을 시도한다. 못 찾으면 조용히 넘어간다(기동을
/// 막을 이유가 없는 편의 기능). Windows 전용 no-op 가드.
pub fn launch_everything(settings: &Settings) {
    #[cfg(windows)]
    {
        let configured = settings
            .get("everythingPath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        // 1.4 정식판과 1.5 알파/베타(별도 'Everything 1.5a' 폴더 + Everything64.exe)
        // 의 기본 설치 경로를 모두 훑는다. 다른 곳에 설치했다면 settings의
        // everythingPath로 직접 지정할 수 있다.
        let candidates = configured.into_iter().chain(
            [
                "C:\\Program Files\\Everything\\Everything.exe".to_string(),
                "C:\\Program Files\\Everything 1.5a\\Everything64.exe".to_string(),
                "C:\\Program Files\\Everything 1.5a\\Everything.exe".to_string(),
                "C:\\Program Files (x86)\\Everything\\Everything.exe".to_string(),
                "C:\\Program Files (x86)\\Everything 1.5a\\Everything.exe".to_string(),
            ]
            .into_iter(),
        );
        for p in candidates {
            if std::path::Path::new(&p).exists() {
                // -startup: 창 없이 백그라운드(트레이)로 시작
                let _ = std::process::Command::new(&p).arg("-startup").spawn();
                return;
            }
        }
        eprintln!("everythingAutostart is on but Everything.exe was not found");
    }
    #[cfg(not(windows))]
    {
        let _ = settings;
    }
}

/* ===== v3.0.0 파일 링크 + Everything(voidtools) 연동 ===== */

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

/// 로컬에서 실행 중인 Everything(voidtools)의 HTTP 서버에 파일명 검색을
/// 위임한다. 응답 JSON 본문을 문자열 그대로 돌려주고 해석은 프론트가 한다
/// (Rust는 IO만 담당한다는 이 저장소의 역할 분담 그대로). Everything이
/// 미실행이거나 HTTP 서버 옵션이 꺼져 있으면 연결이 즉시 실패하며, 프론트는
/// 그것을 "기능 비활성" 신호로 삼아 UI를 숨긴다. 접속지는 127.0.0.1 고정 —
/// 바깥 네트워크로는 절대 나가지 않는다 (내부망 방침 유지).
#[tauri::command]
pub fn everything_search(query: String, port: u16, count: u32) -> Result<String, String> {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream =
        TcpStream::connect_timeout(&addr, Duration::from_millis(400)).map_err(to_err)?;
    stream.set_read_timeout(Some(Duration::from_millis(1500))).map_err(to_err)?;
    stream.set_write_timeout(Some(Duration::from_millis(1500))).map_err(to_err)?;

    // HTTP/1.0 + Connection: close — 청크 인코딩 없이 EOF까지 읽으면 끝이라
    // 외부 HTTP 클라이언트 크레이트 없이도 안전하게 파싱된다.
    let q = url_encode(&query);
    let count = count.clamp(1, 100);
    let req = format!(
        "GET /?search={q}&json=1&path_column=1&count={count} HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes()).map_err(to_err)?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(to_err)?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("잘못된 HTTP 응답")?;
    let status = head.lines().next().unwrap_or("");
    if !status.contains(" 200") {
        return Err(format!("Everything HTTP 응답 오류: {status}"));
    }
    Ok(body.to_string())
}

/// RFC 3986 percent-encoding (unreserved 문자만 통과) — 검색어의 한글·공백·
/// 특수문자를 쿼리스트링에 안전하게 싣기 위한 최소 구현.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn url_encode_passes_unreserved_and_encodes_hangul_and_space() {
        assert_eq!(url_encode("abc-123_.~"), "abc-123_.~");
        assert_eq!(url_encode("계약 a"), "%EA%B3%84%EC%95%BD%20a");
    }

    /// 가짜 로컬 HTTP 서버로 요청 라인·본문 파싱을 검증 — 실제 Everything의
    /// 응답 형식(HTTP/1.0 + JSON 본문)을 흉내낸다.
    #[test]
    fn everything_search_sends_expected_request_and_returns_body() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut req = [0u8; 2048];
            let n = sock.read(&mut req).unwrap();
            let req = String::from_utf8_lossy(&req[..n]).into_owned();
            sock.write_all(
                b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\n\r\n{\"totalResults\":1,\"results\":[{\"type\":\"file\",\"name\":\"a.hwp\",\"path\":\"C:\\\\docs\"}]}",
            )
            .unwrap();
            req
        });
        let body = everything_search("계약 a".into(), port, 10).unwrap();
        let req = server.join().unwrap();
        assert!(
            req.starts_with("GET /?search=%EA%B3%84%EC%95%BD%20a&json=1&path_column=1&count=10 HTTP/1.0\r\n"),
            "unexpected request line: {req}"
        );
        let parsed: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["results"][0]["name"], "a.hwp");
    }

    #[test]
    fn everything_search_errors_fast_when_nothing_listens() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener); // 이 포트엔 아무도 없다
        assert!(everything_search("x".into(), port, 10).is_err());
    }

    #[test]
    fn everything_search_rejects_non_200() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut req = [0u8; 2048];
            let _ = sock.read(&mut req).unwrap();
            sock.write_all(b"HTTP/1.0 401 Unauthorized\r\n\r\n").unwrap();
        });
        assert!(everything_search("x".into(), port, 10).is_err());
    }
}
