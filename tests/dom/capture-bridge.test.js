/* 캡처 브리지 — 이벤트→captureMemo 라우팅(F1 게이트 계약) · 단축키 레코더 · 상주 토글
   shortcutFromEvent/prettyShortcut는 순수 함수지만 capture-bridge.js가
   store.js(최상위 __TAURI__ 구조분해)를 import하므로 여기(DOM 테스트)서 검증한다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initCapture, shortcutFromEvent, prettyShortcut} = await import('../../src/capture-bridge.js');
initCapture();

const $ = id => env.document.getElementById(id);
const key = (id, init) => $(id).dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({bubbles:true}, init)));

test('shortcutFromEvent: 모디파이어+키 → 플러그인 문자열, 미완성 조합은 null', () => {
  assert.equal(shortcutFromEvent({ctrlKey:true, altKey:true, code:'Space', key:' '}), 'Ctrl+Alt+Space');
  assert.equal(shortcutFromEvent({ctrlKey:true, shiftKey:true, code:'KeyM', key:'M'}), 'Ctrl+Shift+KeyM');
  assert.equal(shortcutFromEvent({ctrlKey:true, code:'ControlLeft', key:'Control'}), null); // 모디파이어만 눌린 중간 상태
  assert.equal(shortcutFromEvent({code:'KeyA', key:'a'}), null);                            // 모디파이어 없는 단일 키 거부
  assert.equal(shortcutFromEvent({ctrlKey:true, code:'', key:'x'}), null);
});

test('prettyShortcut: KeyM→M, Digit1→1, 그 외 그대로', () => {
  assert.equal(prettyShortcut('Ctrl+Alt+KeyM'), 'Ctrl+Alt+M');
  assert.equal(prettyShortcut('Ctrl+Shift+Digit1'), 'Ctrl+Shift+1');
  assert.equal(prettyShortcut('Ctrl+Alt+Space'), 'Ctrl+Alt+Space');
});

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

test('레코더: 키 조합 입력 → 표시, 저장 성공 → 설정 반영 + save_settings + 모달 닫힘', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('set_capture_shortcut', () => {});
  $('capKeyBtn').click();                   // 모달 열기 (recorded 리셋)
  assert.ok($('capKeyModal').classList.contains('on'));
  key('ck-rec', {key:'m', code:'KeyM', ctrlKey:true, altKey:true});
  assert.equal($('ck-rec').value, 'Ctrl+Alt+M');
  $('ck-save').click();
  await env.flush();
  assert.equal(S.settings.captureShortcut, 'Ctrl+Alt+KeyM');
  const sc = env.invokeCalls.find(c=>c.cmd==='set_capture_shortcut');
  assert.deepEqual(sc.args, {shortcut:'Ctrl+Alt+KeyM'});
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.captureShortcut==='Ctrl+Alt+KeyM'));
  assert.equal($('capKeyModal').classList.contains('on'), false);
});

test('레코더: 등록 실패(러스트 롤백) → 설정값 불변 + 토스트 + 모달 유지', async () => {
  await env.resetS(); S.loaded = true;
  const before = S.settings.captureShortcut;
  env.onInvoke('set_capture_shortcut', () => { throw new Error('선점됨'); });
  $('capKeyBtn').click();
  key('ck-rec', {key:'q', code:'KeyQ', ctrlKey:true, shiftKey:true});
  $('ck-save').click();
  await env.flush();
  assert.equal(S.settings.captureShortcut, before);
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_settings'));
  assert.ok($('toast').classList.contains('on'));
  assert.ok($('capKeyModal').classList.contains('on'));
});

test('레코더: 조합 없이 저장 → 안내만, invoke 없음', async () => {
  await env.resetS(); S.loaded = true;
  $('capKeyBtn').click();
  $('ck-save').click();
  await env.flush();
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='set_capture_shortcut'));
});

test('상주 토글: closeToTray·autostartMinimized 변경 → 설정 저장', async () => {
  await env.resetS(); S.loaded = true;
  $('capKeyBtn').click();
  $('ck-tray').checked = false;
  $('ck-tray').dispatchEvent(new env.window.Event('change', {bubbles:true}));
  assert.equal(S.settings.closeToTray, false);
  $('ck-automin').checked = false;
  $('ck-automin').dispatchEvent(new env.window.Event('change', {bubbles:true}));
  assert.equal(S.settings.autostartMinimized, false);
  assert.ok(env.invokeCalls.filter(c=>c.cmd==='save_settings').length >= 2);
});

test('자동 시작 토글: set_autostart 성공 → 저장, 실패 → 체크·설정 롤백', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('set_autostart', () => {});
  $('capKeyBtn').click();
  $('ck-auto').checked = true;
  $('ck-auto').dispatchEvent(new env.window.Event('change', {bubbles:true}));
  await env.flush();
  assert.equal(S.settings.autostart, true);
  assert.equal($('ck-automin').disabled, false);

  env.onInvoke('set_autostart', () => { throw new Error('GPO 차단'); });
  $('ck-auto').checked = false;
  $('ck-auto').dispatchEvent(new env.window.Event('change', {bubbles:true}));
  await env.flush();
  assert.equal(S.settings.autostart, true);        // 롤백: 설정값 불변
  assert.equal($('ck-auto').checked, true);        // 체크박스도 원복
  assert.ok($('toast').classList.contains('on'));
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
