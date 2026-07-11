/* 정기함 (v2.42) — 고급 탭 옵트인 토글 + 인라인 목록 + 추가/수정 모달.
   initRecurBox가 60초 setInterval을 걸므로 모의 타이머를 모듈 스코프에서 켠다
   (안 켜면 실제 인터벌이 테스트 프로세스를 붙잡는다 — CLAUDE.md). */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initRecurBox, renderRecurPanel} = await import('../../src/recur-box.js');
initRecurBox();

const $ = id => env.document.getElementById(id);
const change = el => el.dispatchEvent(new env.window.Event('change'));

test('기본 꺼짐: 토글 off + 본문 숨김', async () => {
  await env.resetS();
  renderRecurPanel();
  assert.equal($('set-recur-enabled').checked, false);
  assert.equal($('recurBody').style.display, 'none');
});

test('토글 켜기 → recurEnabled 반영 + save_settings + 본문 표시', async () => {
  await env.resetS(); S.loaded = true;
  const cb = $('set-recur-enabled');
  cb.checked = true; change(cb);
  assert.equal(S.settings.recurEnabled, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings' && c.args.settings.recurEnabled===true));
  assert.notEqual($('recurBody').style.display, 'none');
});

test('추가 모달: 정의 등록 → save_recur_defs + 목록에 표시', async () => {
  await env.resetS(); S.loaded = true; S.settings.recurEnabled = true; renderRecurPanel();
  $('rc-add').click();
  assert.ok($('recurModal').classList.contains('on'));
  $('rc-memo').value = '주간 정례보고';
  $('rc-freq').value = 'daily'; change($('rc-freq'));
  $('rc-dt').querySelector('.dt-date').value = '2030/07/13';   // 먼 미래 → 테스트 중 스폰되지 않음
  $('rc-dt').querySelector('.dt-time').value = '09:00';
  $('rc-save').click();
  assert.equal($('recurModal').classList.contains('on'), false);   // 저장 후 닫힘
  assert.equal(S.recurDefs.length, 1);
  assert.equal(S.recurDefs[0].memo, '주간 정례보고');
  assert.equal(S.recurDefs[0].freq, 'daily');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_recur_defs'));
  assert.match($('recurList').innerHTML, /주간 정례보고/);
});

test('메모 없이 저장 → alert + 등록 안 됨', async () => {
  await env.resetS(); S.loaded = true; S.settings.recurEnabled = true; renderRecurPanel();
  $('rc-add').click();
  $('rc-memo').value = '';
  $('rc-save').click();
  assert.equal(S.recurDefs.length, 0);
  assert.ok(env.alerts.some(a=>/메모/.test(a)));
});

test('일시정지 토글 + 삭제(confirm)', async () => {
  await env.resetS(); S.loaded = true; S.settings.recurEnabled = true;
  S.recurDefs.push({id:1, memo:'주간회의', freq:'weekly', dow:[1], time:{hh:9,mm:0},
    next:new Date(2030,6,15,9,0).toISOString(), paused:false});
  renderRecurPanel();
  $('recurList').querySelector('[data-rtoggle="0"]').click();
  assert.equal(S.recurDefs[0].paused, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_recur_defs'));
  $('recurList').querySelector('[data-rdel="0"]').click();   // confirm 기본 true
  assert.equal(S.recurDefs.length, 0);
});
