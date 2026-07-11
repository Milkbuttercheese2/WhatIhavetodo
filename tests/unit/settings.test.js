/* DEFAULT_SETTINGS 기본값 계약 — 이 값들은 Rust 쪽(lib.rs/commands.rs)과
   반드시 일치해야 한다(새 DB엔 settings 행이 없어 양쪽이 각자 파생). 여기가
   깨지면 첫 실행 동작이 JS/Rust에서 갈린다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS} from '../../src/state.js';

test('DEFAULT_SETTINGS: v2.4 새 키 + Rust 짝 기본값', () => {
  assert.equal(DEFAULT_SETTINGS.alarmOn, true);
  assert.equal(DEFAULT_SETTINGS.alarmSound, true);
  assert.equal(DEFAULT_SETTINGS.closeToTray, true);          // ↔ lib.rs .unwrap_or(true)
  assert.equal(DEFAULT_SETTINGS.autostart, false);           // ↔ sget_bool("autostart", false)
  assert.equal(DEFAULT_SETTINGS.autostartMinimized, true);   // ↔ sget_bool("autostartMinimized", true)
  assert.equal(DEFAULT_SETTINGS.captureShortcut, 'Ctrl+Alt+Space'); // ↔ commands.rs CAPTURE_SHORTCUT
  assert.equal(DEFAULT_SETTINGS.theme, 'system');
});
