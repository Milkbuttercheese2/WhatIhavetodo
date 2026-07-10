# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Versioning convention (user-defined)

User-facing version: current release = **v2.21**. Big updates bump +0.1 (v2.3), small updates +0.01 (v2.22). Manifest mapping: `vX.Y` ↔ `"X.Y.0"`, `vX.YZ` ↔ `"X.YZ.0"` in all THREE manifests together (`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `package.json`). The UI header shows the version via `getVersion()` with a trailing `.0` stripped. A structural analysis lives in `구조 분석 보고서.md`; the built exe ships in `최종 프로그램 산출물/` and IS committed to git per user request.

## Migration in progress

This repo is being converted from the legacy single-file HTML app (still in `legacy/`) into a **Tauri (Rust) + SQLite** desktop app for offline/air-gapped 공무원 내부망 deployment as a small portable `.exe`. The full rationale and architecture (DB schema, data-safety measures, migration/versioning approach, why Tauri, why EAV over a JSON column, etc.) live in the plan doc at `C:\Users\rhama\.claude\plans\rustling-seeking-flurry.md` — read it before making architectural changes to `src-tauri/`.

Status: **Phase 1 and Phase 2 both done.** The frontend now lives in `src/` as browser-native ES modules (see "Frontend layout" below) with `STORE` delegating to Rust via `invoke()`; SQLite is the single source of truth (IndexedDB/localStorage are no longer used). The legacy HTML file in `legacy/` remains the behavioral reference if a business-logic question arises, but `src/` is the live implementation.

## Legacy app (`legacy/뭐해야 했더라v1.41.html`)

Single-file, offline-first Korean personal task-tracking web app (a phone-call triage board — "떠올려서 던져둔 일들을 잊지 않고 처리하기"). It is the **entire (old) application**: one HTML file containing inline `<style>` and `<script>` blocks, plus a vendored copy of SheetJS (xlsx 0.18.5) inlined at the top of the first `<script>` for offline/air-gapped XLSX export. No build step, no package manager, no bundler, no server — opened directly in a browser. Kept around purely as the behavioral reference during the Tauri port; not being developed further itself.

## Running / testing changes

**Rust backend (`src-tauri/`)**: `cd src-tauri && cargo test --lib` runs the DB round-trip test suite (`src-tauri/src/db/tests.rs`) — in-memory + real-file-path tests covering save/load, replace-not-merge semantics, backup export/import, a simulated-restart reopen, and backup rotation pruning. `cargo check`/`cargo build` from `src-tauri/` compile the app. `npm run tauri dev` (repo root) runs the full desktop app. Rust isn't on PATH by default in a fresh shell on this machine — prefix commands with `export PATH="/c/Users/rfast/.cargo/bin:$PATH"` (bash) if `cargo`/`rustc` aren't found.

**Frontend (`src/`)**: no build step, no bundler, no JS tests — `src/` is served raw by the Tauri webview (`frontendDist: "../src"`). Verify changes manually via `npm run tauri dev`: add an item, check board placement, calendar/completed tabs, presets, alarms, backup export/import. `node --check src/<file>.js` catches syntax errors (package.json `"type":"module"` makes node parse them as ESM).

**Legacy HTML app (`legacy/뭐해야 했더라v1.41.html`)**: no build or test command. Verify by opening the file directly in a browser and exercising the UI manually — add an item, check board placement, check the calendar/completed tabs, check backup export/import.

Historically (pre-migration) this project bumped the HTML filename itself per version (e.g. `뭐해야했더라1.2.html` → `뭐해야 했더라v1.41.html`) — check `git log` if that matters.

## Rust backend layout (`src-tauri/src/`)

- `lib.rs` — Tauri builder/setup: resolves the DB path under `%LOCALAPPDATA%` (per-user, no admin rights needed — see `app.path().app_local_data_dir()`), opens the DB, runs `PRAGMA integrity_check` once at startup and stores the result in `AppDb.integrity_ok` (an `AtomicBool`), registers all commands.
- `commands.rs` — thin `#[tauri::command]` wrappers (`load_all`, `save_all`, `save_fields`, `save_presets`, `save_id_kinds`, `save_settings`, `backup_export`, `backup_import`) that just call into `db::*` and map errors to `String`. Business logic does **not** belong here or in `db/` — it stays in the frontend JS (see Migration-in-progress note above); Rust is CRUD-only.
- `db/model.rs` — serde structs matching the frontend's JSON shapes exactly (`Item`, `Contact`, `Identifier`, `SubTask`, `FieldDef`, `Preset`, `Settings`, `AppState`, `BackupPayload`). Field names/renames here are load-bearing — they define the wire format `invoke()` calls and JSON backups use.
- `db/schema.rs` + `db/migrations/*.sql` — ordered migrations run via `rusqlite_migration`, tracked through SQLite's `PRAGMA user_version`. **Only ever append new `M::up(...)` migrations; never edit or reorder a shipped one** — there's no auto-updater on the target intranet, so an install may jump straight from an old schema version to the newest, skipping releases.
- `db/items.rs`, `fields.rs`, `presets.rs`, `id_kinds.rs`, `settings.rs` — one module per table group, each exposing a `save_*_tx(&Transaction, ...)` (the actual delete+reinsert logic) plus a `save_*(&mut Connection, ...)` convenience wrapper that opens its own transaction and calls the `_tx` version. This split exists so `db/backup.rs::import_payload` can compose all five into **one** all-or-nothing transaction when restoring a JSON backup.
- `db/alarm.rs` — encodes/decodes the single-key alarm-fired state (`items.due_alarm`, `subtasks.alarm`) between the JS shape (`true` or a snooze-until epoch-ms number) and the TEXT column.
- `db/mod.rs` — `open()` (pragmas + migrate), `integrity_check()`, `rotate_backup()` (timestamped `.sqlite` copies under a `backups/` dir, pruned to the newest N), `now_stamp()`.

Ids are never reassigned by the DB layer — `items.id`/`subtasks.id` are caller-supplied (from the frontend's `newId()`) and inserted as-is, not autoincremented, so alarm state embedded on a subtask stays attached to the right row across saves. Custom (non-`received`/`due`) item fields live in an EAV table (`item_fields`) rather than a JSON column, chosen specifically so the hand-rolled migration system can use plain `INSERT/UPDATE/DELETE` rather than JSON-path surgery.

## Frontend layout (`src/` — browser-native ES modules, no bundler)

Split from the former single-file `app.js` in v2.21 along single-responsibility lines. Two rules keep the module graph safe (import specifiers are relative `./name.js` with explicit extensions; there is no bundler to fix mistakes):

1. **Feature modules contain only hoisted `function` declarations plus module-local `let` state — no top-level statements besides `import`.** All listener registration, `setInterval`s, and initial render calls live in an exported `init*()` that `main.js` calls in explicit order. This is what makes the two deliberate function-only import cycles (render↔form via `openForm`/`persist`, render↔calendar via `cardHtml`/`renderCal`) safe; don't add top-level `const x = importedValue` inside a cycle member.
2. **All cross-module mutable state lives in the single `S` object** (`state.js`) — mutate properties (`S.items = ...`), never rebind imports. `window.items/FIELDS/PRESETS/ID_KINDS/SETTINGS` are write-only devtools mirrors of `S.*` (kept for console debugging); code always reads `S`.

- `state.js` — `S` (items/fields/presets/idKinds/settings/loaded/lastId/imported), `CORE_FIELDS` + `DEFAULT_*`, `newId()` (F12), `migrateItem()`, `reconcileCore()`. `S.imported` is the async handoff channel filled by `STORE.load()`/backup import and consumed by `reconcileImported()`.
- `dom-utils.js` — `$`, `esc`/`escAttr` (F8/F11), `enableDragReorder`, toast, `askNotify`.
- `placement.js` — `placeOf()` / `dayBounds` / `PLACE_NAME` (the core scheduling logic).
- `datetime.js` — date/time parsers (F3/F4/F13), dt input widget helpers, `DOW`/`fmtT`/`fmtDue`, `initDtDelegation()` (document-level delegated listeners for the widget).
- `store.js` — `invoke` (from `window.__TAURI__.core`; `withGlobalTauri: true`), `STORE` persistence facade (single-flight `saveAll` queue, F1 gate on `S.loaded`), `setStatus`.
- `form.js` — quick input (`toInbox`) + form panel; `editingId` is module-local, reset only via `closeForm()`.
- `presets.js` — preset buttons + management modal + id-kind name management.
- `render.js` — `render()`/`renderDone()`/`cardHtml()`/`persist()`; search state `q`/`dq` module-local.
- `calendar.js` — month grid + day detail; `calY/calM/calSel` module-local.
- `alarms.js` — `checkAlarms()` 20s poll (F5), beep, title flash, alarm toggle.
- `backup.js` — JSON backup/restore, `reconcileImported()`, XLSX export (uses global `XLSX` from the classic `vendor/xlsx.full.min.js` script tag, which must stay a non-module script loaded before `main.js`), data-dir change.
- `main.js` — entry (`<script type="module">` in index.html): wiring order, tabs, Ctrl+S/ESC (F14), clock, the initial-load IIFE (`STORE.load` → `migrateItem` → `S.loaded=true` → `reconcileImported` → pending-merge → `render`).

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
  - **알람 (alarms)** — `checkAlarms()` polls every 20s, comparing due/mid timestamps against now, using per-item `al` state to avoid re-firing; uses the Notification API + a beep + title-bar flashing as a fallback.
  - **구버전 마이그레이션** — `migrateItem()` upgrades old item shapes (pre-v5: `who/org/phone` on the item's field object, `title/summary`, `notice/sr`) into the current shape (`contacts[]`, `memo`, `ids[]`).
  - **초기 로드** — the IIFE at the very end loads from IndexedDB, migrates, reconciles anything the user entered before load finished, and calls `render()`.

## Data model

An item (`it`) has: `id`, `memo`, `f` (field values, keyed by `FIELDS[].key`, e.g. `f.received`, `f.due`), `contacts[]` (`{who, org, phone}`), `ids[]` (`{kind, val}` — identifier numbers like 입찰공고번호/SR번호), `subs[]` (sub-tasks: `{id, title, mid, done, al}`), `done`, `staged` (true = still in 분류 대기/inbox), and `al` (per-item alarm-fired state keyed by field name).

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
