# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Collaboration workflow (user-defined — two co-equal collaborators)

`Milkbuttercheese2/WhatIhavetodo` (owner's GitHub account, formerly `wooseongkyun`) is the **single shared repo** — both collaborators have Write access directly on it. There is no fork-based workflow anymore: `origin` points straight at `Milkbuttercheese2/WhatIhavetodo`. (A personal fork at `rfastball/WhatIhavetodo` still exists as a backup/history artifact from before the collaborator invite, but is not part of the active workflow — don't push there.)

**Never commit directly to `main`.** For any change:
1. Branch off `main`: `git checkout -b <type>/<short-name>` — prefix matches this repo's commit-message convention (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`), e.g. `feat/recurring-tasks`.
2. Push the branch to `origin` and open a PR (branch → `main`) **within this one repo** — not cross-repo.
3. Merge via the PR once reviewed; delete the branch after.

Branch-protection rules on `main` (require PR, block direct push) have **not** been configured yet on GitHub as of 2026-07-11 — that requires the repo owner's admin access, which the assistant does not have. Until it's set, direct pushes to `main` are *technically* possible but against this project's convention; follow the branch+PR flow regardless. There is no always-on CI on this repo — `npm test` / `cargo test --lib` are run locally before opening/merging a PR. The only GitHub Actions workflow is `build-windows-exe.yml` (manual `workflow_dispatch` only): it runs both test suites, does the official MSVC release build on windows-latest, and commits the exe to the branch it was run on.

## Versioning convention (user-defined)

Current release = **v2.4.3**.

> ⚠️ **버전 이력 주의 (반드시 읽을 것 — 과거에 여기서 혼선이 있었다):** 저장소 git 히스토리에는
> `v3.0.0`·`v3.1.0` 커밋과 CHANGELOG 항목이 남아 있지만, **v3.x는 실제로 배포된 적이 없다.**
> 그 작업은 *다른 계정에서 진행되던 미배포 개편*이었고, 당시 파일 링크·이름 변경 정도의 변화를
> 두고 **대규모 개편(major)도 아닌데 버전을 3.0.0으로 임의 상향**해 버린 것이다(잘못된 범프).
> 저장소 소유자 결정으로 이를 바로잡아, 실제 정식 배포는 **구 v2.31 라인을 잇는 `v2.4.0`**
> 으로 되돌렸다. 따라서:
> - **현재/실제 배포 버전 = v2.4.3.** 세 매니페스트(package.json·Cargo.toml·tauri.conf.json) 동일.
> - v3.0.0·v3.1.0 CHANGELOG 항목은 *내부 이력*으로만 읽고, 실 배포 번호로 착각하지 말 것.
> - **다음 버전은 v2.4.x(버그·사소한 조정) / v2.5.0(기능 추가)로 이어간다.** 진짜 호환성 깨지는
>   대규모 개편이 아닌 한 다시 3.x로 올리지 말 것. (자동 업데이터·버전 비교 로직이 없어 역전은 무해.)
> - **버전업 정책(소유자 지정): 사소한 수정이라도 새로 배포(빌드/머지)할 때마다 패치(Z)를 올린다.**
>   매 배포마다 세 매니페스트 버전을 함께 올리고 CHANGELOG에 해당 버전 항목을 추가하며 PR 제목에도
>   `[vX.Y.Z]`를 붙인다.

**The project uses standard X.Y.Z semver** (X = 큰 개편/호환성 변화, Y = 기능 추가, Z = 버그 수정·소규모 조정), and the same `"X.Y.Z"` string goes into all THREE manifests together (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `package.json`). The UI header shows `getVersion()` verbatim (v3.0.0에서 구 십진수 규칙의 trailing-`.0` 절삭을 폐지 — `main.js`). The app was also renamed at v3.0.0: **'뭐하려 했더라'** (formerly '뭐해야 했더라'); the internal `productName`/crate name stay `wmhh-desktop` and the bundle identifier stays `com.wooseongkyun.wmhh` on purpose — changing the identifier would move `app_local_data_dir()` and orphan existing users' config/data. Legacy versions (≤ v2.31) used a decimal-magnitude scheme (v2.2 → v2.21 → … → v2.3(=2.30) → v2.31): read old CHANGELOG entries with that rule, and note those old manifest versions sort non-monotonically as semver (harmless — no auto-updater or version-comparison logic exists; don't add tooling that assumes semver ordering across the v2 era). A structural analysis lives in `구조 분석 보고서.md`; the built exe ships in `최종 프로그램 산출물/뭐하려 했더라.exe` and IS committed to git per user request.

**Changelog rule (user-defined, since v2.3):** every update pushed to GitHub must add an entry to `CHANGELOG.md` describing what changed (Korean, grouped 변경/추가/수정). Started at the v2.2→v2.3 transition — write the entry as part of the same PR/commit that makes the change.

## Migration in progress

This repo is being converted from the legacy single-file HTML app (still in `legacy/`) into a **Tauri (Rust) + SQLite** desktop app for offline/air-gapped 공무원 내부망 deployment as a small portable `.exe`. The full rationale and architecture (DB schema, data-safety measures, migration/versioning approach, why Tauri, why EAV over a JSON column, etc.) live in the plan doc at `C:\Users\rhama\.claude\plans\rustling-seeking-flurry.md` — read it before making architectural changes to `src-tauri/`.

Status: **Phase 1 and Phase 2 both done.** The frontend now lives in `src/` as browser-native ES modules (see "Frontend layout" below) with `STORE` delegating to Rust via `invoke()`; SQLite is the single source of truth (IndexedDB/localStorage are no longer used). The legacy HTML file in `legacy/` remains the behavioral reference if a business-logic question arises, but `src/` is the live implementation.

## Legacy app (`legacy/뭐해야 했더라v1.41.html`)

Single-file, offline-first Korean personal task-tracking web app (a phone-call triage board — "떠올려서 던져둔 일들을 잊지 않고 처리하기"). It is the **entire (old) application**: one HTML file containing inline `<style>` and `<script>` blocks, plus a vendored copy of SheetJS (xlsx 0.18.5) inlined at the top of the first `<script>` for offline/air-gapped XLSX export. No build step, no package manager, no bundler, no server — opened directly in a browser. Kept around purely as the behavioral reference during the Tauri port; not being developed further itself.

## Running / testing changes

**Rust backend (`src-tauri/`)**: `cd src-tauri && cargo test --lib` runs the DB round-trip test suite (`src-tauri/src/db/tests.rs`) — in-memory + real-file-path tests covering save/load, replace-not-merge semantics, backup export/import, a simulated-restart reopen, and backup rotation pruning. `cargo check`/`cargo build` from `src-tauri/` compile the app. `npm run tauri dev` (repo root) runs the full desktop app. Rust isn't on PATH by default in a fresh shell on this machine — prefix commands with `export PATH="/c/Users/rfast/.cargo/bin:$PATH"` (bash) if `cargo`/`rustc` aren't found.

**Frontend (`src/`)**: no build step, no bundler — `src/` is served raw by the Tauri webview (`frontendDist: "../src"`). **`npm test`** runs the node:test suite in `tests/` (108 tests: pure-logic in `tests/unit/`, jsdom-based DOM tests in `tests/dom/`). `tests/helpers/env.js` builds the window/document/`__TAURI__` fake — in DOM test files, src modules MUST be dynamically imported *after* `setupEnv()` (store.js destructures `window.__TAURI__.core` at import time), and `mock.timers.enable(...)` must run at module scope or real `setInterval`s from `init*()` hang the test process. Never import `main.js` in tests (its load IIFE runs at import). dt-widget-shaped fixtures need seconds zeroed (`d.setSeconds(0,0)`) or no-change round-trips falsely re-arm alarms. Still verify UI-feel changes manually via `npm run tauri dev`; `node --check src/<file>.js` catches syntax errors.

**Legacy HTML app (`legacy/뭐해야 했더라v1.41.html`)**: no build or test command. Verify by opening the file directly in a browser and exercising the UI manually — add an item, check board placement, check the calendar/completed tabs, check backup export/import.

Historically (pre-migration) this project bumped the HTML filename itself per version (e.g. `뭐해야했더라1.2.html` → `뭐해야 했더라v1.41.html`) — check `git log` if that matters.

## Rust backend layout (`src-tauri/src/`)

- `lib.rs` — Tauri builder/setup: resolves the DB path under `%LOCALAPPDATA%` (per-user, no admin rights needed — see `app.path().app_local_data_dir()`), opens the DB, runs `PRAGMA integrity_check` once at startup and stores the result in `AppDb.integrity_ok` (an `AtomicBool`), registers all commands.
- `commands.rs` — thin `#[tauri::command]` wrappers (`load_all`, `save_all`, `save_fields`, `save_presets`, `save_id_kinds`, `save_settings`, `backup_export`, `backup_import`, …) that just call into `db::*` and map errors to `String`, plus the global mini-capture shortcut: `CAPTURE_SHORTCUT` is **fixed to Ctrl+Alt+Space since v2.31** (no runtime re-binding; the old `set_capture_shortcut`/`set_autostart`/`save_recur_defs` commands were removed). it also has `pick_file_path`/`open_file_path`/`reveal_file_path` (file links, via the dialog/opener plugins) and `quick_search`/`resize_capture` (mini capture window). (The `everything_search`/`launch_everything`/`load_settings_only` commands were **removed in v2.4.0** along with the whole Everything integration — search got slow.) Business logic does **not** belong here or in `db/` — it stays in the frontend JS (see Migration-in-progress note above); Rust is CRUD-only.
- `db/model.rs` — serde structs matching the frontend's JSON shapes exactly (`Item`, `Contact`, `Identifier`, `SubTask`, `FieldDef`, `Preset`, `Settings`, `AppState`, `BackupPayload`). Field names/renames here are load-bearing — they define the wire format `invoke()` calls and JSON backups use.
- `db/schema.rs` + `db/migrations/*.sql` — ordered migrations run via `rusqlite_migration`, tracked through SQLite's `PRAGMA user_version`. **Only ever append new `M::up(...)` migrations; never edit or reorder a shipped one** — there's no auto-updater on the target intranet, so an install may jump straight from an old schema version to the newest, skipping releases.
- `db/items.rs`, `fields.rs`, `presets.rs`, `id_kinds.rs`, `settings.rs`, `recur_defs.rs` (v2.3 정기함 definitions — the 정기함 *feature* was removed in v2.31, but this module and its table stay so old data keeps round-tripping through `load_all`/backups; migrations are append-only) — one module per table group, each exposing a `save_*_tx(&Transaction, ...)` (the actual delete+reinsert logic) plus a `save_*(&mut Connection, ...)` convenience wrapper that opens its own transaction and calls the `_tx` version. This split exists so `db/backup.rs::import_payload` can compose all of them into **one** all-or-nothing transaction when restoring a JSON backup.
- `db/alarm.rs` — encodes/decodes the single-key alarm-fired state (`items.due_alarm`, `subtasks.alarm`) between the JS shape (`true` or a snooze-until epoch-ms number) and the TEXT column.
- `db/mod.rs` — `open()` (pragmas + migrate), `integrity_check()`, `rotate_backup()` (timestamped `.sqlite` copies under a `backups/` dir, pruned to the newest N), `now_stamp()`.

Ids are never reassigned by the DB layer — `items.id`/`subtasks.id` are caller-supplied (from the frontend's `newId()`) and inserted as-is, not autoincremented, so alarm state embedded on a subtask stays attached to the right row across saves. Custom (non-`received`/`due`) item fields live in an EAV table (`item_fields`) rather than a JSON column, chosen specifically so the hand-rolled migration system can use plain `INSERT/UPDATE/DELETE` rather than JSON-path surgery.

## Frontend layout (`src/` — browser-native ES modules, no bundler)

Split from the former single-file `app.js` in v2.21 along single-responsibility lines. Two rules keep the module graph safe (import specifiers are relative `./name.js` with explicit extensions; there is no bundler to fix mistakes):

1. **Feature modules contain only hoisted `function` declarations plus module-local `let` state — no top-level statements besides `import`.** All listener registration, `setInterval`s, and initial render calls live in an exported `init*()` that `main.js` calls in explicit order. This is what makes the two deliberate function-only import cycles (render↔form via `openForm`/`persist`, render↔calendar via `cardHtml`/`renderCal`) safe; don't add top-level `const x = importedValue` inside a cycle member.
2. **All cross-module mutable state lives in the single `S` object** (`state.js`) — mutate properties (`S.items = ...`), never rebind imports. `window.items/FIELDS/PRESETS/ID_KINDS/SETTINGS` are write-only devtools mirrors of `S.*` (kept for console debugging); code always reads `S`.

- `state.js` — `S` (items/fields/presets/idKinds/settings/recurDefs/loaded/lastId/imported), `CORE_FIELDS` + `DEFAULT_*`, `newId()` (F12), `makeItem()` (single source of the item shape — new item fields get their default here), `toggleDone()` (domain op behind the card checkbox), `migrateItem()`, `reconcileCore()`. `S.recurDefs` is legacy-data pass-through only since v2.31 (see Data model). `S.imported` is the async handoff channel filled by `STORE.load()`/backup import and consumed by `reconcileImported()`.
- `dom-utils.js` — `$`, `esc`/`escAttr` (F8/F11), `enableDragReorder`, toast, `askNotify`.
- `recur.js` (주기 업무, reworked v2.4.0) — pure math (`isValidRecur`/`nextOccurrence`/`initialNext`/`recurLabel`) **plus the parent-child generator** `spawnDueOccurrences(items, now)`. Recurrence lives on a **parent** item (`it.recur` = `{type:"dow"|"monthly"|"every", dow/day/days, time, next, paused}`, stored in `items.recur` TEXT — reuses migration 004's column, no new migration). A parent lives *off the board* (`placeOf` returns `'recur'`; render/calendar/done filter it out) and holds only common info (memo + schedule). The generator (`spawnDueOccurrences`) runs a **weekly Monday-06:00 batch**: once now is past a Monday 06:00 it spawns every occurrence whose `next` is before the *following* Monday 06:00 (`nextMondaySix`), so a whole week's tasks appear Monday morning (each child keeps its own occurrence time as `f.due`). Each spawn creates a **child** — a normal board item with `recurId` = parent.id and `f.due` = the occurrence — then advances `next` (persisted, so no duplicate spawns; occurrences >14 days stale are skipped to avoid a flood). Time input accepts HH:MM or colon-less HHMM (normalized). Child↔parent are navigable both ways (`it.recurId` ↔ `items.filter(recurId===p.id)`). **v2.4.4: the `every` (며칠마다/N-day) input was removed from the UI — creation offers only 매주 요일(dow) / 매월 며칠(monthly). recur.js still handles `type:"every"` so already-stored `every` parents keep spawning/round-tripping (data compat); only the input dropdown dropped it.**
- `recur-box.js` (v2.4.0) — the **[설정] 메뉴 → 주기 업무 입력·관리** entry + modal: minimal parent form (memo + schedule) and the 주기 업무 관리 list (edit/pause/delete, next-occurrence, child count). No standalone board button — the old `[주기 입력]` capture-area button was removed in v2.4.0 (entry is the settings menu). Exposes `initRecurBox()` and `runRecurSpawn()` (called by main.js on load + every 60s).
- `settings-menu.js` — header [설정] dropdown that hosts 저장 위치/백업/불러오기/XLSX/프리셋·식별번호 관리/주기 업무 입력·관리 buttons (ids unchanged — action listeners stay in their own modules). (The two Everything toggles were removed in v2.4.0.)
- `filters.js` — `haystack()`/`textMatch()` search predicates (pure functions, no state/DOM; board search and done search share them, and future saved-filter views build on them). Since v3.0.0 the haystack includes linked file *names* (last path segment only, not folder names).
- (`everything.js` — **removed in v2.4.0**. The Everything(voidtools) file-search integration was deleted because it slowed the board/quick-memo search.) File links are **not shown on board cards since v2.4.1** — cards render memo(2 lines)·earliest sub·due only; files live in the form popup (`form.js` `addFormFileRow`) where each row has an active↔edit toggle (active = name shown as a link that opens on click / edit = editable path input + a **찾기** button calling `pick_file_path`).
- `placement.js` — `placeOf()` / `dayBounds` / `PLACE_NAME` (the core scheduling logic).
- `datetime.js` — date/time parsers (F3/F4/F13), dt input widget helpers, `DOW`/`fmtT`/`fmtDue`, `initDtDelegation()` (document-level delegated listeners for the widget).
- `store.js` — `invoke` (from `window.__TAURI__.core`; `withGlobalTauri: true`), `STORE` persistence facade (single-flight `saveAll` queue, F1 gate on `S.loaded`).
- `form.js` — quick input (`toInbox`) + form panel; `editingId` is module-local, reset only via `closeForm()`.
- `presets.js` — preset buttons + management modal + id-kind name management.
- `render.js` — `render()`/`renderDone()`/`cardHtml()`/`persist()`; search state `q`/`dq` module-local (matching itself delegates to `filters.js`). Board columns sort by earliest arriving timestamp (pending sub `mid`s + `f.due` merged, ascending; no-time items last, newest first) since v2.3.
- `calendar.js` — month grid + day detail; `calY/calM/calSel` module-local.
- `alarms.js` — `checkAlarms()` 20s poll (F5), beep, title flash, alarm toggle.
- `backup.js` — JSON backup/restore, `reconcileImported()`, XLSX export (uses global `XLSX` from the classic `vendor/xlsx.full.min.js` script tag, which must stay a non-module script loaded before `main.js`), data-dir change.
- `main.js` — entry (`<script type="module">` in index.html): wiring order, tabs, Ctrl+S/ESC (F14), clock, the initial-load IIFE (`STORE.load` → `migrateItem` → `S.loaded=true` → `reconcileImported` → pending-merge → `render`).
- `capture-win.js` / `capture-boot.js` / `capture-bridge.js` (v2.23 global-shortcut mini capture; shortcut fixed to Ctrl+Alt+Space since v2.31, no settings UI) — `capture-win.js` runs ONLY in the capture webview and must not import main-app modules (store.js's top-level `__TAURI__` destructure would break, and module state would run twice); it emits the memo text as an event instead of saving. `capture-boot.js` is the capture.html-only entry so `capture-win.js` stays importable in tests. `capture-bridge.js` is the main-window side: receives the event and feeds `captureMemo()` so the F1 load gate/save queue/pending-merge all apply, plus the one-time hidden-to-tray notice toast; access `__TAURI__.event` lazily inside functions, never at module top level.

**Drag & drop caveat (v3.0.0):** the main window sets `"dragDropEnabled": false` in `tauri.conf.json`. On Windows WebView2 this is REQUIRED for HTML5 drag-and-drop (`enableDragReorder` — sub-task/preset/id-kind reordering) to work at all; the trade-off is that native OS file-drop onto the window can never be used. Don't re-enable it.

Removed in v2.31 (kept here so old references make sense): `recur-box.js` (정기함 modal), the `state.js` recurrence generator (`reconcileRecur` etc.), the `saveStatus`/`setStatus` save-failure indicator, and the ⚡ 빠른 메모 settings modal (shortcut recorder + tray/autostart toggles).

## File layout (line ranges are for `legacy/뭐해야 했더라v1.41.html`)

- **Lines 1–9**: `<head>` meta/fonts.
- **Lines 10–34**: inlined SheetJS library (vendored, minified — do not hand-edit).
- **Lines 35–367**: `<style>` — CSS custom properties for the color palette (`--stage-inbox`, `--stage-today`, `--stage-doing`, `--stage-planned`, defined near the top of `:root`) drive both column dots and card left-border colors.
- **Lines 369–546**: HTML body — header/toolbar, the "바로 입력/양식 입력" capture section and form panel, the search strip, the board (4 columns), the calendar view, and the completed-items view.
- **Lines 550+**: app `<script>`, organized into clearly delimited `/* ===== */` sections (search for these to navigate):
  - **저장 계층 (storage layer)** — `STORE` object wrapping IndexedDB (`wmhh-db`), with a `localStorage` mirror as a secondary safety net and a one-time migration path from older `deskflow_*`/`wmhh_*` localStorage keys into IndexedDB.
  - **필드 정의 (field definitions)** — `CORE_FIELDS` (접수시각/마감시각) plus user-defined custom fields, merged via `reconcileCore()`.
  - **날짜/시간 유틸** — parsers for split date/time text inputs (multiple date formats accepted).
  - **자동 배치 규칙 (auto-placement rules)** — `placeOf(item)`, the core scheduling logic that decides which board column an item belongs in (`inbox`/`today`/`doing`/`planned`/`done`) purely from its due date and sub-task check-in times ("mid"). This is the most important function to understand before touching board behavior.
  - **프리셋 (presets)** — reusable form templates.
  - **바로 입력 / 양식 패널** — the two capture flows (freeform memo vs. structured form with contacts/IDs/sub-tasks).
  - **렌더 (render)** — `render()`, `cardHtml()`, `renderDone()`, `renderCal()` regenerate DOM from the `items` array; there's no virtual DOM, everything is innerHTML-based.
  - **알람 (alarms)** — `checkAlarms()` polls every 20s, comparing due/mid timestamps against now, using per-item `al` state to avoid re-firing; uses the Notification API + a beep + title-bar flashing as a fallback. **Card dots (`alarmDot` in render.js) were simplified to 3 states in v2.4.4: ○ ad-wait(대기) / ● ad-ring(울림, passed & unacked/snoozed) / ● ad-done(확인함, `al===true`); the old 미룸/snooze color (ad-snooze) was dropped — snoozed alarms fold into ad-ring. Done items/subs show no dot. `earliestSub` now shows a rung (passed-pending) sub before a future one so the red dot isn't hidden behind an upcoming check-in.**
  - **구버전 마이그레이션** — `migrateItem()` upgrades old item shapes (pre-v5: `who/org/phone` on the item's field object, `title/summary`, `notice/sr`) into the current shape (`contacts[]`, `memo`, `ids[]`).
  - **초기 로드** — the IIFE at the very end loads from IndexedDB, migrates, reconciles anything the user entered before load finished, and calls `render()`.

## Data model

An item (`it`) has: `id`, `memo`, `f` (field values, keyed by `FIELDS[].key`, e.g. `f.received`, `f.due`), `contacts[]` (`{who, org, phone}`), `ids[]` (`{kind, val}` — identifier numbers like 입찰공고번호/SR번호), `subs[]` (sub-tasks: `{id, title, mid, done, al}`), `files[]` (v3.0.0 — plain path strings linked to the item; stored in the `item_files` table; since v2.4.1 shown only in the form popup (not on cards), with a per-row active/edit toggle — active opens via the opener plugin, edit lets you retype the path or pick a new one), `done`, `staged` (true = still in 분류 대기/inbox), `al` (per-item alarm-fired state keyed by field name), `recur` (v2.4.0 주기 업무: on a **parent** definition = `{type,dow/day/days,time,next,paused}`; null on normal items — a non-null `recur` marks the item as an off-board parent, see recur.js), and `recurId` (v2.4.0: on a **child** = the parent's id it was spawned from; null for a normal/hand-made item). (Historically `recurId` was the v2.3 정기함 soft link; v2.4.0 revives the parent-child model using the same column.) The legacy `recur_defs` table + `S.recurDefs` still round-trip through `load_all`/JSON backups for old-data preservation (no longer the active mechanism — parents are plain items now).

Board placement is **always derived**, never stored: `placeOf(it)` recomputes the column every render from `done`/`staged`/`f.due`/sub-task `mid` timestamps relative to "now" and to today's day-boundaries (`dayBounds()`). If you change scheduling behavior, change `placeOf()`, not per-item state.

## Persistence & data safety

- Primary store is SQLite via `STORE` → `invoke()` (in the legacy app it was IndexedDB with a localStorage mirror).
- `S.loaded` is the load-gate flag (see `F1` comment; formerly `LOADED`) — saves are blocked until the initial load completes, specifically to prevent an empty in-memory `S.items` array from clobbering existing stored data on startup. Preserve this gate if you touch the save path.
- `newId()` (see `F12` comment) generates monotonically increasing IDs from `Date.now()`, bumping by 1 on collision within the same millisecond — do not switch this to `Math.random()` or a non-monotonic scheme, since `migrateItem()` seeds `S.lastId` from existing max IDs (both live in `state.js` for exactly this reason).
- Manual backup/restore is JSON via `doBackup()`/the `bkImp`/`bkFile` handlers (uses `showSaveFilePicker` when available, falling back to a download link), and there's a separate one-way XLSX export (`xlsx` button, via the vendored SheetJS). JSON backup is the only *round-trippable* format — XLSX is export-only.

## Conventions in this codebase

- Numbered inline comments like `F1`, `F5`, `F7`, `F12` mark specific past bugfixes/invariants (e.g. "F1: block saves before initial load to avoid data loss", "F12: monotonic id to avoid same-ms collisions"). Treat these as load-bearing constraints, not stylistic notes — read the comment before changing the code near it.
- Code is dense/terse by house style (short-circuit chains, ternaries, minimal whitespace) rather than heavily decomposed — match the existing style rather than introducing a different formatting convention for new code.
- All user-facing strings are Korean; keep new UI text consistent with the existing tone (plain, direct, no honorific/formal register beyond what's already there).
