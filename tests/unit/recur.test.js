/* 정기함 도메인 — nextRecurDate · dayStart · reconcileRecur 생성기 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
const {S, makeItem, nextRecurDate, dayStart, reconcileRecur} = await import('../../src/state.js');

const DAY = 86400000;
const isoLocal = (y,mo,d,hh=9,mm=0) => new Date(y,mo,d,hh,mm,0,0).toISOString();
function reset(){ S.items=[]; S.recurDefs=[]; S.lastId=0; }

test('nextRecurDate: 매일 = +1일, 시:분 보존', () => {
  const a=isoLocal(2026,6,10,18,30);
  const n=nextRecurDate(a,{freq:'daily'});
  assert.equal(new Date(n)-new Date(a), DAY);
  assert.equal(new Date(n).getHours(), 18);
});
test('nextRecurDate: 매주 요일 미지정 = +7일 / 지정 = 다음 해당 요일', () => {
  const a=isoLocal(2026,6,10);
  assert.equal(new Date(nextRecurDate(a,{freq:'weekly'}))-new Date(a), 7*DAY);
  for(const target of [0,1,2,3,4,5,6]){
    const n=new Date(nextRecurDate(a,{freq:'weekly',dow:[target]}));
    assert.equal(n.getDay(), target);
    const gap=(n-new Date(a))/DAY; assert.ok(gap>=1&&gap<=7);
  }
});
test('nextRecurDate: 매월 = 다음 달 같은 일, 짧은 달 클램프(1/31→2/28)', () => {
  const n=new Date(nextRecurDate(isoLocal(2026,0,31,9,0),{freq:'monthly'}));
  assert.equal(n.getMonth(), 1); assert.equal(n.getDate(), 28);
});
test('dayStart: 로컬 자정, 손상 ISO는 NaN', () => {
  const d=new Date(isoLocal(2026,6,10,18,0)); const ds=new Date(dayStart(d.toISOString()));
  assert.equal(ds.getHours(), 0); assert.equal(ds.getDate(), d.getDate());
  assert.ok(Number.isNaN(dayStart('깨진값')));
});

test('reconcileRecur: 회차의 날이 시작되면 보드에 스폰 + next 전진 + recurId', () => {
  reset();
  const now=new Date(2026,6,10,10,0);                      // 오늘 10:00
  S.recurDefs.push({id:1, memo:'야근 체크', freq:'daily', dow:[], time:{hh:18,mm:0}, next:isoLocal(2026,6,10,18,0), paused:false});
  const changed=reconcileRecur(now);
  assert.equal(changed, true);
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].recurId, 1);
  assert.equal(S.items[0].memo, '야근 체크');
  // next는 다음 날로 전진
  assert.equal(new Date(S.recurDefs[0].next)-new Date(isoLocal(2026,6,10,18,0)), DAY);
});
test('reconcileRecur: 회차 날이 아직 미래면 스폰 안 함(보드는 처리할 것만)', () => {
  reset();
  const now=new Date(2026,6,8,10,0);                       // 8일
  S.recurDefs.push({id:1, memo:'미래건', freq:'weekly', dow:[], time:{hh:9,mm:0}, next:isoLocal(2026,6,13,9,0), paused:false});
  assert.equal(reconcileRecur(now), false);
  assert.equal(S.items.length, 0);
});
test('reconcileRecur: 열린(미완료) 회차가 있으면 정의당 하나만 — 추가 스폰 안 함', () => {
  reset();
  const now=new Date(2026,6,10,10,0);
  S.items.push(makeItem({memo:'이미 올라온 회차', recurId:1, done:false, f:{due:isoLocal(2026,6,10,18,0)}}));
  S.recurDefs.push({id:1, memo:'야근', freq:'daily', dow:[], time:{hh:18,mm:0}, next:isoLocal(2026,6,11,18,0), paused:false});
  assert.equal(reconcileRecur(now), false);
  assert.equal(S.items.length, 1);
});
test('reconcileRecur: 완료된 회차만 있으면 다음 회차를 스폰', () => {
  reset();
  const now=new Date(2026,6,11,10,0);
  S.items.push(makeItem({memo:'어제 완료', recurId:1, done:true, f:{due:isoLocal(2026,6,10,18,0)}}));
  S.recurDefs.push({id:1, memo:'야근', freq:'daily', dow:[], time:{hh:18,mm:0}, next:isoLocal(2026,6,11,18,0), paused:false});
  assert.equal(reconcileRecur(now), true);
  assert.equal(S.items.filter(it=>!it.done).length, 1);   // 오늘치 새로 스폰
});
test('reconcileRecur: 일시정지면 스폰 안 함', () => {
  reset();
  const now=new Date(2026,6,10,10,0);
  S.recurDefs.push({id:1, memo:'멈춤', freq:'daily', dow:[], time:{hh:18,mm:0}, next:isoLocal(2026,6,10,18,0), paused:true});
  assert.equal(reconcileRecur(now), false);
  assert.equal(S.items.length, 0);
});
test('reconcileRecur: 앱이 꺼져 놓친 회차들은 가장 최근 하나로 접어 스폰', () => {
  reset();
  const now=new Date(2026,6,10,10,0);                      // 10일. next는 3일 전
  S.recurDefs.push({id:1, memo:'매일', freq:'daily', dow:[], time:{hh:9,mm:0}, next:isoLocal(2026,6,7,9,0), paused:false});
  assert.equal(reconcileRecur(now), true);
  assert.equal(S.items.length, 1);                         // 3개 아니라 1개
  assert.equal(new Date(S.items[0].f.due).getDate(), 10);  // 오늘치
  assert.equal(new Date(S.recurDefs[0].next).getDate(), 11);
});
