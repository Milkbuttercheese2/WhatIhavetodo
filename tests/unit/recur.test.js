/* 주기 업무 — nextOccurrence/isValidRecur/recurLabel + completeOccurrence 재장전 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextOccurrence, isValidRecur, recurLabel, DOW_KO} from '../../src/recur.js';
import {S, makeItem, completeOccurrence} from '../../src/state.js';

/* 2026-07-14 = 화요일 (getDay()=2). 로컬시간 기준 고정점 */
const TUE = new Date(2026, 6, 14, 10, 0, 0, 0);

test('isValidRecur: 정상/비정상 모양 판별', () => {
  assert.equal(isValidRecur({type:'dow', dow:[1,3], time:'09:00'}), true);
  assert.equal(isValidRecur({type:'every', days:3, time:'18:30'}), true);
  assert.equal(isValidRecur(null), false);
  assert.equal(isValidRecur({type:'dow', dow:[], time:'09:00'}), false);        // 요일 없음
  assert.equal(isValidRecur({type:'every', days:0, time:'09:00'}), false);      // 1 미만
  assert.equal(isValidRecur({type:'every', days:3, time:'25:00'}), false);      // 시각 무효
  assert.equal(isValidRecur({type:'monthly', time:'09:00'}), false);            // 미지원 타입
});

test('dow: 같은 요일이라도 시각이 지났으면 다음 주로', () => {
  // 화 10:00 기준, 매주 화 09:00 → 오늘 09:00은 지남 → 다음 주 화
  const iso = nextOccurrence({type:'dow', dow:[2], time:'09:00'}, TUE);
  const d = new Date(iso);
  assert.equal(d.getDay(), 2);
  assert.ok(d - TUE > 6*24*3600e3);
});

test('dow: 오늘 아직 안 지난 시각이면 오늘', () => {
  const iso = nextOccurrence({type:'dow', dow:[2], time:'18:00'}, TUE);
  const d = new Date(iso);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 18);
});

test('dow: 여러 요일 중 가장 가까운 요일 (화 기준 월·금 → 금)', () => {
  const iso = nextOccurrence({type:'dow', dow:[1,5], time:'09:00'}, TUE);
  assert.equal(new Date(iso).getDay(), 5);
});

test('every: 기준일에서 N일 뒤 같은 시각 (완료 시점 앵커)', () => {
  const iso = nextOccurrence({type:'every', days:3, time:'14:00'}, TUE);
  const d = new Date(iso);
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 14);
});

test('무효 recur → 빈 문자열 (호출부가 무시)', () => {
  assert.equal(nextOccurrence(null, TUE), '');
  assert.equal(nextOccurrence({type:'dow', dow:[], time:'09:00'}, TUE), '');
});

test('recurLabel: 사람이 읽는 요약', () => {
  assert.equal(recurLabel({type:'dow', dow:[1,3], time:'09:00'}), '매주 월·수 09:00');
  assert.equal(recurLabel({type:'every', days:3, time:'18:30'}), '매 3일 18:30');
  assert.equal(DOW_KO.length, 7);
});

test('completeOccurrence: 완료 기록 분리(아카이브) + 원본 재장전 — 데이터 소실 없음', () => {
  S.lastId = 0;
  const it = makeItem({memo:'주간 보고', recur:{type:'dow', dow:[1], time:'09:00'},
    f:{received:'r', due:'2026-07-13T00:00:00.000Z'},
    subs:[{id:1, title:'초안', done:true, al:{mid:true}}, {id:2, title:'제출', done:false, al:{}}],
    contacts:[{who:'a',org:'b',phone:'c'}], ids:[{kind:'k',val:'v'}], files:['C:\\x.hwp'],
    al:{due:true}});
  const origId = it.id;
  const archived = completeOccurrence(it, '2026-07-20T00:00:00.000Z');

  // 완료 기록: 새 id, done, recur 없음(다시 반복 안 함), 그 회차의 상태 보존
  assert.notEqual(archived.id, origId);
  assert.equal(archived.done, true);
  assert.equal(typeof archived.doneAt, 'number');
  assert.equal(archived.recur, null);
  assert.equal(archived.f.due, '2026-07-13T00:00:00.000Z');   // 지난 회차 마감 보존
  assert.equal(archived.subs[0].done, true);                   // 세부 진행 상태 보존
  assert.deepEqual(archived.files, ['C:\\x.hwp']);
  assert.equal(archived.contacts.length, 1);

  // 원본: 같은 id 유지, 다음 회차로 재장전 (세부·알람 초기화, 마감 갱신)
  assert.equal(it.id, origId);
  assert.equal(it.done, false);
  assert.equal(it.f.due, '2026-07-20T00:00:00.000Z');
  assert.equal(it.subs.every(s=>!s.done), true);
  assert.deepEqual(it.al, {});
  assert.deepEqual(it.recur, {type:'dow', dow:[1], time:'09:00'});

  // 얕은 공유로 인한 오염 없음: 원본 세부를 바꿔도 아카이브는 그대로
  it.subs[0].title='변경';
  assert.equal(archived.subs[0].title, '초안');
});
