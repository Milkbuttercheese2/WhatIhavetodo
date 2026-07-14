/* 주기 업무 — 부모-자식 생성기: nextOccurrence/initialNext/spawnDueOccurrences */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nextOccurrence, isValidRecur, recurLabel, DOW_KO, initialNext, spawnDueOccurrences} from '../../src/recur.js';
import {S, makeItem} from '../../src/state.js';

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
  const iso = nextOccurrence({type:'dow', dow:[2], time:'09:00'}, TUE);
  const d = new Date(iso);
  assert.equal(d.getDay(), 2);
  assert.ok(d - TUE > 6*24*3600e3);
});

test('dow: 여러 요일 중 가장 가까운 요일 (화 기준 월·금 → 금)', () => {
  const iso = nextOccurrence({type:'dow', dow:[1,5], time:'09:00'}, TUE);
  assert.equal(new Date(iso).getDay(), 5);
});

test('every: 기준일에서 N일 뒤 같은 시각', () => {
  const iso = nextOccurrence({type:'every', days:3, time:'14:00'}, TUE);
  const d = new Date(iso);
  assert.equal(d.getDate(), 17);
  assert.equal(d.getHours(), 14);
});

test('monthly: 이달 지정일이 남았으면 그날, 지났으면 다음달', () => {
  const d1 = new Date(nextOccurrence({type:'monthly', day:20, time:'09:00'}, new Date(2026,6,14,10,0,0,0)));
  assert.equal(d1.getMonth(), 6); assert.equal(d1.getDate(), 20);       // 7/20
  const d2 = new Date(nextOccurrence({type:'monthly', day:5, time:'09:00'}, new Date(2026,6,14,10,0,0,0)));
  assert.equal(d2.getMonth(), 7); assert.equal(d2.getDate(), 5);        // 지남 → 8/5
});
test('monthly: 없는 날짜(31일)는 그 달 말일로 맞춤', () => {
  const d = new Date(nextOccurrence({type:'monthly', day:31, time:'09:00'}, new Date(2026,1,1,0,0,0,0)));
  assert.equal(d.getMonth(), 1);                                        // 2월
  assert.equal(d.getDate(), 28);                                        // 2026 2월 말일
});
test('monthly: isValidRecur/recurLabel', () => {
  assert.equal(isValidRecur({type:'monthly', day:15, time:'09:00'}), true);
  assert.equal(isValidRecur({type:'monthly', day:0, time:'09:00'}), false);
  assert.equal(isValidRecur({type:'monthly', day:32, time:'09:00'}), false);
  assert.equal(recurLabel({type:'monthly', day:15, time:'09:00'}), '매월 15일 09:00');
});

test('initialNext: 오늘 시각이 아직 안 지난 dow면 오늘', () => {
  const now = new Date(2026, 6, 14, 8, 0, 0, 0);              // 화 08:00
  const d = new Date(initialNext({type:'dow', dow:[2], time:'09:00'}, now));
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 9);
});
test('initialNext: 오늘 시각이 지났으면 다음 회차', () => {
  const now = new Date(2026, 6, 14, 12, 0, 0, 0);            // 화 12:00
  const d = new Date(initialNext({type:'dow', dow:[2], time:'09:00'}, now));
  assert.ok(d > now);
  assert.equal(d.getDay(), 2);
});

test('recurLabel: 사람이 읽는 요약', () => {
  assert.equal(recurLabel({type:'dow', dow:[1,3], time:'09:00'}), '매주 월·수 09:00');
  assert.equal(recurLabel({type:'every', days:3, time:'18:30'}), '매 3일 18:30');
  assert.equal(DOW_KO.length, 7);
});

test('spawnDueOccurrences: 예정일 도래분만 자식 생성 + next 전진 + 재실행 중복 없음 (데이터 소실 방지)', () => {
  S.lastId = 0;
  const now = new Date(2026, 6, 14, 12, 0, 0, 0);            // 화 12:00
  // 지난 월요일(7/6)부터 시작하는 매주 월 정의. 오늘(7/14)까지 도래: 7/6, 7/13 → 2건
  const parent = makeItem({memo:'주간보고', recur:{type:'dow', dow:[1], time:'09:00',
    next:new Date(2026,6,6,9,0,0,0).toISOString()}});
  const items = [parent];

  const first = spawnDueOccurrences(items, now);
  assert.equal(first.length, 2);
  assert.equal(first[0].recurId, parent.id);      // 자식 → 부모 링크
  assert.equal(first[0].memo, '주간보고');         // 공통정보 스냅샷
  assert.ok(first[0].f.due);
  assert.equal(first[0].recur, null);             // 자식은 부모가 아님
  const nx = new Date(parent.recur.next);
  assert.equal(nx.getDay(), 1);
  assert.ok(nx > now);                            // next는 미래 월요일로 전진

  // 재실행: next가 이미 전진했으므로 중복 생성 없음
  items.push(...first);
  assert.equal(spawnDueOccurrences(items, now).length, 0);
});

test('spawnDueOccurrences: 14일보다 오래 밀린 회차는 생성 없이 건너뜀 (폭주 방지)', () => {
  S.lastId = 0;
  const now = new Date(2026, 6, 14, 12, 0, 0, 0);
  const parent = makeItem({memo:'매일', recur:{type:'every', days:1, time:'09:00',
    next:new Date(2026,0,1,9,0,0,0).toISOString()}});    // 반년 전부터 밀림
  const sp = spawnDueOccurrences([parent], now);
  assert.ok(sp.length <= 15);                     // 최근 14일치 정도만
  assert.ok(new Date(parent.recur.next) > now);
});

test('spawnDueOccurrences: 일시정지 부모는 생성 안 함', () => {
  S.lastId = 0;
  const now = new Date(2026, 6, 14, 12, 0, 0, 0);
  const p = makeItem({memo:'x', recur:{type:'every', days:1, time:'09:00',
    next:new Date(2026,6,13,9,0,0,0).toISOString(), paused:true}});
  assert.equal(spawnDueOccurrences([p], now).length, 0);
});

test('부모-자식 양방향 탐색 (정규화 링크)', () => {
  S.lastId = 0;
  const now = new Date(2026, 6, 14, 8, 0, 0, 0);            // 화 08:00 → 오늘 09:00 회차 생성
  const p = makeItem({memo:'p', recur:{type:'dow', dow:[2], time:'09:00'}});
  const items = [p];
  const sp = spawnDueOccurrences(items, now);
  items.push(...sp);
  assert.ok(sp.length >= 1);
  const child = sp[0];
  assert.equal(items.find(x => x.id === child.recurId).id, p.id);          // 자식 → 부모
  assert.equal(items.filter(x => x.recurId === p.id).length, sp.length);   // 부모 → 자식
});
