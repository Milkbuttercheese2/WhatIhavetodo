/* 알람 — 발화 조건 · F5(모달 중 재알림 금지) · F6(스누즈) · 확인/미룸 · 토글 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {checkAlarms, initAlarms} = await import('../../src/alarms.js');
initAlarms();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();
const mk = o => Object.assign({id:newId(), memo:'m', done:false, staged:false, f:{}, contacts:[], ids:[], subs:[], al:{}}, o);
const closeModal = () => { $('alarmBg').classList.remove('on'); };

test('지난 마감 → 모달 + #마감 항목 + focus_main_window', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'지난 마감건', f:{due:iso(-5)}}));
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  assert.ok($('alarmList').textContent.includes('#마감'));
  assert.ok($('alarmList').textContent.includes('지난 마감건'));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='focus_main_window'));
  closeModal();
});

test('지난 미완료 세부 mid → #중간점검 / 완료 sub·완료 아이템은 침묵', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({subs:[{id:newId(), title:'회신 점검', mid:iso(-3), done:false, al:{}}]}));
  checkAlarms();
  assert.ok($('alarmList').textContent.includes('#중간점검'));
  closeModal();

  await env.resetS(); S.loaded = true;
  S.items.push(
    mk({subs:[{id:newId(), title:'done sub', mid:iso(-3), done:true, al:{}}]}),
    mk({memo:'done item', done:true, f:{due:iso(-3)}}),
  );
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);
});

test('al=true(확인됨)·스누즈 중은 미발화, 스누즈 만료는 발화 (F6)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({f:{due:iso(-5)}, al:{due:true}}));                 // 확인됨
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);

  S.items[0].al.due = Date.now() + 60e3;                              // 스누즈 중
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);

  S.items[0].al.due = Date.now() - 1;                                 // 스누즈 만료
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  closeModal();
});

test('alarmOn=false → 억제', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.alarmOn = false;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  assert.equal($('alarmBg').classList.contains('on'), false);
});

test('F5: 모달이 이미 떠 있으면 목록을 다시 쓰지 않음', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'첫 알람', f:{due:iso(-5)}}));
  checkAlarms();
  const firstList = $('alarmList').innerHTML;
  S.items.push(mk({memo:'둘째 알람', f:{due:iso(-4)}}));
  checkAlarms();                                                      // 모달 열림 중 → no-op
  assert.equal($('alarmList').innerHTML, firstList);
  closeModal();
});

test('확인 → al=true + 모달 닫힘 + persist', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  $('alarmOk').click();
  await env.flush();
  assert.equal(S.items[0].al.due, true);
  assert.equal($('alarmBg').classList.contains('on'), false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('미룸 → al = now+10분 (±5초)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  const before = Date.now();
  $('alarmSnooze').click();
  await env.flush();
  const st = S.items[0].al.due;
  assert.equal(typeof st, 'number');
  assert.ok(Math.abs(st - (before + 600000)) < 5000);
  assert.equal($('alarmBg').classList.contains('on'), false);
});

test('토글: alarmOn 반전 + save_settings + 버튼 표시 + 열린 모달 닫기', async () => {
  await env.resetS(); S.loaded = true;
  S.settings.alarmOn = true;
  S.items.push(mk({f:{due:iso(-5)}}));
  checkAlarms();
  assert.ok($('alarmBg').classList.contains('on'));
  $('alarmToggle').click();                                           // 끄기
  await env.flush();
  assert.equal(S.settings.alarmOn, false);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_settings'));
  assert.equal($('alarmToggle').textContent, '🔕 알람 꺼짐');
  assert.equal($('alarmBg').classList.contains('on'), false);         // 모달도 닫힘
  $('alarmToggle').click();                                           // 다시 켜기
  assert.equal(S.settings.alarmOn, true);
  assert.equal($('alarmToggle').textContent, '🔔 알람 켜짐');
});
