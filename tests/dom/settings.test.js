/* 설정 창 — 열기/닫기·탭 전환·각 컨트롤의 "즉시 반영+저장" 계약·단축키 레코더·
   Rust 세터 롤백·테마 적용. env.js는 matchMedia를 스텁하지 않으므로 systemPrefersDark
   가드가 없으면 여기서 터진다(가드 검증 겸용). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initSettings, resolveTheme, applyTheme} = await import('../../src/settings.js');
initSettings();

const $ = id => env.document.getElementById(id);
const change = el => el.dispatchEvent(new env.window.Event('change'));

test('resolveTheme: light/dark는 그대로, system은 matchMedia 없으면 light', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('system'), 'light');   // env엔 matchMedia 없음 → 가드가 false
});

test('resolveTheme: system + OS 다크 선호 → dark', () => {
  const prev = env.window.matchMedia;
  env.window.matchMedia = () => ({matches:true, addEventListener(){}});
  try { assert.equal(resolveTheme('system'), 'dark'); }
  finally { env.window.matchMedia = prev; }
});

test('gear 클릭으로 열고 닫기 버튼으로 닫힌다', async () => {
  await env.resetS();
  assert.equal($('settingsBg').classList.contains('on'), false);
  $('settingsBtn').click();
  assert.ok($('settingsBg').classList.contains('on'));
  $('setClose').click();
  assert.equal($('settingsBg').classList.contains('on'), false);
});

test('탭 클릭이 해당 패널만 .on 으로 바꾼다', async () => {
  await env.resetS();
  $('settingsBtn').click();                 // 기본 일반 탭
  assert.ok(env.document.querySelector('.set-panel[data-panel="general"]').classList.contains('on'));
  env.document.querySelector('.set-tab[data-set="data"]').click();
  assert.ok(env.document.querySelector('.set-panel[data-panel="data"]').classList.contains('on'));
  assert.equal(env.document.querySelector('.set-panel[data-panel="general"]').classList.contains('on'), false);
});

test('고급 탭: nav 버튼과 슬롯 컨테이너가 있고 클릭 시 전환된다', async () => {
  await env.resetS();
  $('settingsBtn').click();                 // 기본 일반 탭
  const advTab = env.document.querySelector('.set-tab[data-set="advanced"]');
  const advPanel = env.document.querySelector('.set-panel[data-panel="advanced"]');
  assert.ok(advTab, '고급 탭 버튼 존재');
  assert.ok(advPanel, '고급 패널 존재');
  assert.ok($('setAdvSlots'), '고급 기능 슬롯 컨테이너 존재');
  assert.equal(advPanel.classList.contains('on'), false);   // 처음엔 숨김
  advTab.click();
  assert.ok(advPanel.classList.contains('on'));             // 전환됨
  assert.equal(env.document.querySelector('.set-panel[data-panel="general"]').classList.contains('on'), false);
});

test('닫기 동작 체크박스 → S.settings.closeToTray + save_settings', async () => {
  await env.resetS(); S.loaded = true;
  $('settingsBtn').click();
  $('set-tray').checked = false; change($('set-tray'));
  assert.equal(S.settings.closeToTray, false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.closeToTray===false));
});

test('알람 켜기 체크박스 → alarmOn 반영 + 헤더 토글 텍스트 동기화', async () => {
  await env.resetS(); S.loaded = true;
  $('settingsBtn').click();
  $('set-alarmon').checked = false; change($('set-alarmon'));
  assert.equal(S.settings.alarmOn, false);
  assert.match($('alarmToggle').textContent, /꺼짐/);   // renderAlarmToggle 동기화
});

test('알람 소리 체크박스 → alarmSound 반영 + 저장', async () => {
  await env.resetS(); S.loaded = true;
  $('settingsBtn').click();
  $('set-alarmsound').checked = false; change($('set-alarmsound'));
  assert.equal(S.settings.alarmSound, false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.alarmSound===false));
});

test('자동 실행 성공: set_autostart 호출 + 설정 반영 + 최소화 옵션 활성화', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('set_autostart', () => undefined);
  $('settingsBtn').click();
  assert.equal($('set-automin').disabled, true);        // 초기: 자동실행 꺼짐이라 비활성
  $('set-autostart').checked = true; change($('set-autostart'));
  await env.flush();
  assert.ok(env.invokeCalls.some(c=>c.cmd==='set_autostart' && c.args.enabled===true));
  assert.equal(S.settings.autostart, true);
  assert.equal($('set-automin').disabled, false);
});

test('자동 실행 실패: 체크박스 롤백 + 설정값 불변', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('set_autostart', () => { throw new Error('레지스트리 거부'); });
  $('settingsBtn').click();
  $('set-autostart').checked = true; change($('set-autostart'));
  await env.flush();
  assert.equal($('set-autostart').checked, false);      // 롤백
  assert.equal(S.settings.autostart, false);            // 설정값도 안 건드림
});

test('테마 라디오 → S.settings.theme + <html data-theme> 적용', async () => {
  await env.resetS(); S.loaded = true;
  $('settingsBtn').click();
  const dark = env.document.querySelector('#settingsBg input[name="theme"][value="dark"]');
  dark.checked = true; change(dark);
  assert.equal(S.settings.theme, 'dark');
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
});

test('단축키 레코더: keydown 기록 → 저장 시 set_capture_shortcut 호출 + 반영', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('set_capture_shortcut', () => undefined);
  $('settingsBtn').click();
  $('sk-rec').dispatchEvent(new env.window.KeyboardEvent('keydown',
    {code:'KeyM', key:'m', ctrlKey:true, altKey:true, bubbles:true}));
  assert.equal($('sk-rec').value, 'Ctrl+Alt+M');        // prettyShortcut 표시
  $('sk-save').click();
  await env.flush();
  assert.ok(env.invokeCalls.some(c=>c.cmd==='set_capture_shortcut' && c.args.shortcut==='Ctrl+Alt+KeyM'));
  assert.equal(S.settings.captureShortcut, 'Ctrl+Alt+KeyM');
});

test('applyTheme: 저장된 theme 를 <html>에 반영 (복원 경로 계약)', async () => {
  await env.resetS();
  S.settings.theme = 'dark'; applyTheme();
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  S.settings.theme = 'light'; applyTheme();
  assert.equal(env.document.documentElement.dataset.theme, 'light');
});
