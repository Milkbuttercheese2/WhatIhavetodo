/* 정기함 모달 — 정의 추가 → 저장 + 도래 시 보드 스폰 · 목록/일시정지 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {initRender} = await import('../../src/render.js');
const {initRecurBox} = await import('../../src/recur-box.js');
initRender(); initRecurBox();

const $ = id => env.document.getElementById(id);
const pad2 = n => String(n).padStart(2,'0');
const input = el => el.dispatchEvent(new env.window.Event('input',{bubbles:true}));
const change = el => el.dispatchEvent(new env.window.Event('change',{bubbles:true}));
function fillStart(dateStr, timeStr){ const dt=$('rc-dt'); dt.querySelector('.dt-date').value=dateStr; dt.querySelector('.dt-time').value=timeStr; input(dt.querySelector('.dt-date')); }
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}/${pad2(n.getMonth()+1)}/${pad2(n.getDate())}`; };

test('정기함 버튼 → 모달 열림', async () => {
  await env.resetS(); S.loaded=true;
  $('recurBtn').click();
  assert.ok($('recurModal').classList.contains('on'));
  $('recurModal').classList.remove('on');
});

test('정의 추가(매일·오늘 시작) → recurDefs 저장 + 오늘 회차 보드 스폰', async () => {
  await env.resetS(); S.loaded=true;
  $('recurBtn').click();
  $('rc-memo').value='정례보고';
  $('rc-freq').value='daily'; change($('rc-freq'));
  fillStart(todayStr(), '18:00');
  $('rc-save').click();
  await env.flush();
  // 정의 저장
  assert.equal(S.recurDefs.length, 1);
  assert.equal(S.recurDefs[0].freq, 'daily');
  assert.equal(S.recurDefs[0].memo, '정례보고');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_recur_defs'));
  // 오늘 시작이므로 즉시 스폰(recurId 연결)
  const spawned=S.items.find(it=>it.recurId===S.recurDefs[0].id);
  assert.ok(spawned, '오늘 회차가 스폰되어야 함');
  assert.equal(spawned.memo, '정례보고');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
  $('recurModal').classList.remove('on');
});

test('매주 선택 시 요일 칩 노출, 미래 시작이면 스폰 안 함', async () => {
  await env.resetS(); S.loaded=true;
  $('recurBtn').click();
  $('rc-freq').value='weekly'; change($('rc-freq'));
  assert.notEqual($('rc-dow-wrap').style.display, 'none');
  $('rc-memo').value='주간 회의';
  // 먼 미래 날짜
  const f=new Date(Date.now()+30*86400000);
  fillStart(`${f.getFullYear()}/${pad2(f.getMonth()+1)}/${pad2(f.getDate())}`, '09:00');
  $('rc-save').click();
  await env.flush();
  assert.equal(S.recurDefs.length, 1);
  assert.equal(S.items.filter(it=>it.recurId===S.recurDefs[0].id).length, 0);  // 아직 안 올라옴
  $('recurModal').classList.remove('on');
});

test('일시정지 토글 → paused 반영 + 저장', async () => {
  await env.resetS(); S.loaded=true;
  S.recurDefs.push({id:1, memo:'멈출 것', freq:'daily', dow:[], time:{hh:18,mm:0}, next:new Date(Date.now()+86400000).toISOString(), paused:false});
  $('recurBtn').click();                        // renders list
  env.invokeCalls.length=0;
  $('recurList').querySelector('[data-rtoggle]').click();
  await env.flush();
  assert.equal(S.recurDefs[0].paused, true);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_recur_defs'));
  $('recurModal').classList.remove('on');
});
