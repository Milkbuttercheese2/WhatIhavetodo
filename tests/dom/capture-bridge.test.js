/* 캡처 브리지 — 이벤트→captureMemo 라우팅(F1 게이트 계약) + 트레이 첫 안내.
   단축키는 v2.31부터 Rust 고정값(설정 UI 없음)이라 여기서 검증할 게 없다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initCapture} = await import('../../src/capture-bridge.js');
initCapture();

const $ = id => env.document.getElementById(id);

test('캡처 이벤트 수신: S.loaded=true → 아이템 push + save_all', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://capture-memo', {text:'  전화 메모  '});
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '전화 메모');
  assert.equal(S.items[0].staged, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('F1 게이트: S.loaded=false → 아이템은 push되지만 save_all은 없음 (pending-merge 계약)', async () => {
  await env.resetS();                       // S.loaded=false
  env.fireEvent('wmhh://capture-memo', {text:'로드 전 메모'});
  await env.flush();
  assert.equal(S.items.length, 1);          // 메모는 인메모리에 남아 pending-merge가 수거
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('빈 payload 이벤트는 무시', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://capture-memo', {});
  env.fireEvent('wmhh://capture-memo', undefined);
  await env.flush();
  assert.equal(S.items.length, 0);
});

test('트레이 첫 안내: hidden-to-tray 후 창 focus 시 1회만 토스트 + 플래그 저장', async () => {
  await env.resetS(); S.loaded = true;
  env.fireEvent('wmhh://hidden-to-tray');
  $('toast').classList.remove('on');
  env.window.dispatchEvent(new env.window.Event('focus'));
  await env.flush();
  assert.ok($('toast').classList.contains('on'));
  assert.equal(S.settings.trayNoticeShown, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.trayNoticeShown===true));
  // 두 번째부터는 침묵
  env.fireEvent('wmhh://hidden-to-tray');
  $('toast').classList.remove('on');
  env.window.dispatchEvent(new env.window.Event('focus'));
  await env.flush();
  assert.equal($('toast').classList.contains('on'), false);
});
