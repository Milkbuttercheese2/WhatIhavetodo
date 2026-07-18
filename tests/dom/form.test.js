/* 양식 패널 — 왕복 보존 · F2(마감 변경 시 알람 재무장) · F3(오입력 차단) */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {isoToDateStr, isoToTimeStr} = await import('../../src/datetime.js');
const {toInbox, captureMemo, openForm, closeForm, initForm} = await import('../../src/form.js');
initForm();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();
const input = el => el.dispatchEvent(new env.window.Event('input', {bubbles:true}));

/* dt 위젯은 HH:MM까지만 왕복하므로 실사용 mid/due는 항상 초가 0이다 —
   픽스처도 초를 0으로 맞춰야 무변경 저장에서 ISO가 동일하게 재조합된다 */
const isoMin = min => { const d = new Date(Date.now() + min*60e3); d.setSeconds(0,0); return d.toISOString(); };

function fullItem(){
  const due = isoMin(60*26), mid = isoMin(60*27);
  return {
    id: newId(), memo:'전화 문의 건', done:false, staged:false,
    f:{received: iso(-10), due},
    contacts:[{who:'김담당', org:'모부서', phone:'010-1111-2222'}],
    ids:[{kind:'SR번호', val:'SR-1'}, {kind:'자체번호', val:'X-9'}],   // 자체번호 = 기타(커스텀)
    subs:[{id:newId(), title:'회신', mid, done:false, al:{mid:true}}],
    al:{due:true},
  };
}

test('toInbox: staged 아이템 생성 + save_all + 입력창 클리어', async () => {
  await env.resetS(); S.loaded = true;
  $('inp').value = '  급한 메모  ';
  toInbox();
  await env.flush();
  assert.equal(S.items.length, 1);
  const it = S.items[0];
  assert.equal(it.memo, '급한 메모');
  assert.equal(it.staged, true);
  assert.ok(!isNaN(new Date(it.f.received)));
  assert.equal($('inp').value, '');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('captureMemo: trim된 staged 아이템 생성 + save_all (toInbox·캡처 창 공용 코어)', async () => {
  await env.resetS(); S.loaded = true;
  assert.equal(captureMemo('  통화 메모  '), true);
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '통화 메모');
  assert.equal(S.items[0].staged, true);
  assert.deepEqual(S.items[0].al, {});
  assert.ok(!isNaN(new Date(S.items[0].f.received)));
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('captureMemo: 빈/공백 텍스트는 false — 아이템도 저장도 없음', async () => {
  await env.resetS(); S.loaded = true;
  assert.equal(captureMemo('   '), false);
  assert.equal(captureMemo(null), false);
  await env.flush();
  assert.equal(S.items.length, 0);
  assert.ok(!env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('openForm: 풀 아이템 렌더 — dt·관련인·식별번호(기타 포함)·세부 data-subid', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal($('fm-memo').value, it.memo);
  // dt 필드
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  assert.equal(dueSpan.querySelector('.dt-date').value, isoToDateStr(it.f.due));
  assert.equal(dueSpan.querySelector('.dt-time').value, isoToTimeStr(it.f.due));
  // 관련인
  const crow = $('fm-contacts').querySelector('.contact-row');
  assert.equal(crow.querySelector('.c-who').value, '김담당');
  // 식별번호: 커스텀 kind는 '기타' 선택 + 직접입력 노출
  const idRows = $('fm-ids').querySelectorAll('.fid-row');
  assert.equal(idRows.length, 2);
  assert.equal(idRows[1].querySelector('.fid-kind').value, '기타');
  assert.equal(idRows[1].querySelector('.fid-etc').value, '자체번호');
  // 세부: data-subid 유지
  assert.equal($('fm-subs').querySelector('.fsub-row').dataset.subid, String(it.subs[0].id));
  closeForm();
});

test('무변경 저장 왕복: memo/contacts/ids/subs 보존 + sub al 보존', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  const before = JSON.parse(JSON.stringify({memo:it.memo, contacts:it.contacts, ids:it.ids}));
  openForm(it);
  $('fm-save').click();
  await env.flush();
  assert.equal($('formPanel').classList.contains('on'), false);
  const after = S.items[0];
  assert.equal(after.memo, before.memo);
  assert.deepEqual(after.contacts, before.contacts);
  assert.deepEqual(after.ids, before.ids);
  assert.deepEqual(after.subs[0].al, {mid:true});   // mid 무변경 → al 보존
  assert.equal(after.al.due, true);                 // 마감 무변경 → 알람 확인상태 유지 (F2)
  assert.equal(after.staged, false);
});

test('F2: 마감 변경 시 al.due 삭제(알람 재무장)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  const newDue = iso(60*50);
  dueSpan.querySelector('.dt-date').value = isoToDateStr(newDue);
  dueSpan.querySelector('.dt-time').value = isoToTimeStr(newDue);
  input(dueSpan.querySelector('.dt-date'));
  $('fm-save').click();
  await env.flush();
  assert.ok(!('due' in S.items[0].al));
});

test('세부 mid 변경 → 해당 sub의 al 리셋', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const subDt = $('fm-subs').querySelector('.fsub-dt');
  const newMid = iso(60*40);
  subDt.querySelector('.dt-date').value = isoToDateStr(newMid);
  subDt.querySelector('.dt-time').value = isoToTimeStr(newMid);
  $('fm-save').click();
  await env.flush();
  assert.deepEqual(S.items[0].subs[0].al, {});
});

test('신규 저장: 새 id로 push, al:{}', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '새 업무';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '새 업무');
  assert.equal(typeof S.items[0].id, 'number');
  assert.deepEqual(S.items[0].al, {});
});

test('F3: 오입력(시각만 입력)은 저장 차단 — alert + 패널 유지 + 상태 불변', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '오입력 테스트';
  const dueSpan = $('fm-grid').querySelector('[data-fkey="due"]');
  dueSpan.querySelector('.dt-time').value = '18:00';   // 날짜 없이 시각만 → null
  $('fm-save').click();
  await env.flush();
  assert.equal(env.alerts.length, 1);
  assert.match(env.alerts[0], /날짜·시각 입력이 올바르지 않습니다/);
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal(S.items.length, 0);
  closeForm();
});

test('세부 제목에서 Enter → 마지막 행이면 새 행 추가', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  const rows0 = $('fm-subs').querySelectorAll('.fsub-row').length;
  const title = $('fm-subs').querySelector('.fsub-title');
  title.dispatchEvent(new env.window.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
  assert.equal($('fm-subs').querySelectorAll('.fsub-row').length, rows0 + 1);
  closeForm();
});

test('연락처는 입력 그대로 저장 — 자동 하이픈 변환 없음 (v2.5.1)', async () => {
  await env.resetS(); S.loaded = true;
  openForm({});
  $('fm-memo').value = '전화 입력 건';
  const ph = $('fm-contacts').querySelector('.c-phone');
  ph.value = '01099998888';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items[0].contacts[0].phone, '01099998888');   // 억지 변환하지 않는다
});

test('식별번호 행에 드래그 핸들 존재 — 순서 변경 가능 (v2.5.1)', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);
  const idRows = $('fm-ids').querySelectorAll('.fid-row');
  assert.equal(idRows.length, 2);
  for(const r of idRows) assert.ok(r.querySelector('.drag-handle'));
  // DOM 순서를 뒤집으면 collectForm(저장)도 그 순서를 따른다
  $('fm-ids').appendChild(idRows[0]);
  $('fm-save').click();
  await env.flush();
  assert.deepEqual(S.items[0].ids.map(x=>x.kind), ['자체번호','SR번호']);
  assert.deepEqual(S.items[0].ids.map(x=>x.val), ['X-9','SR-1']);
});

test('closeForm 후에는 편집 대상이 리셋됨 — 새 저장은 새 아이템', async () => {
  await env.resetS(); S.loaded = true;
  const it = fullItem(); S.items.push(it);
  openForm(it);            // 편집 모드 진입
  closeForm();             // editingId 리셋
  openForm({});            // 빈 양식
  $('fm-memo').value = '별개의 새 업무';
  $('fm-save').click();
  await env.flush();
  assert.equal(S.items.length, 2);
  assert.equal(S.items[0].memo, it.memo);   // 원본 무변경
});
