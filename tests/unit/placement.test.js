/* placeOf 자동 배치 규칙 — 전 분기. 픽스처는 실제 now 기준 상대 생성 */
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {placeOf, dayBounds, subMids, PLACE_NAME, setPlaceMode, placeMode, ownerOf} from '../../src/placement.js';

/* MODE는 모듈 상태 — owner 모드 테스트가 실패해도 다른 테스트가 오염되지 않게 항상 리셋 */
afterEach(() => setPlaceMode('time'));

const iso = min => new Date(Date.now() + min*60e3).toISOString();
const base = o => Object.assign({done:false, staged:false, f:{}, subs:[]}, o);

test('done이면 마감이 지났어도 done', () => {
  assert.equal(placeOf(base({done:true, f:{due:iso(-120)}})), 'done');
});

test('staged면 inbox', () => {
  assert.equal(placeOf(base({staged:true})), 'inbox');
});

test('지난 마감 → today', () => {
  assert.equal(placeOf(base({f:{due:iso(-60)}})), 'today');
});

test('오늘 안 마감 → today', () => {
  // 자정 직전 플레이크 방지: 오늘 경계에서 직접 생성하되, now 이후가 아니어도
  // 지난 마감 분기 역시 today이므로 결과는 동일하다
  const [, t1] = dayBounds();
  const dueToday = new Date(t1.getTime() - 60e3).toISOString();
  assert.equal(placeOf(base({f:{due:dueToday}})), 'today');
});

test('지난 미완료 세부 점검 → today / 완료 sub의 지난 mid는 무시(전부 완료 → doing)', () => {
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(-30), done:false}]})), 'today');
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(-30), done:true}]})), 'doing');
});

test('오늘 안 도래할 세부 점검 → today', () => {
  const [, t1] = dayBounds();
  const midToday = new Date(Math.min(t1.getTime()-1, Date.now()+60e3)).toISOString();
  assert.equal(placeOf(base({subs:[{title:'a', mid:midToday, done:false}]})), 'today');
});

test('일부 완료 subs(시각은 내일 이후) → doing (started)', () => {
  const it = base({subs:[
    {title:'끝', done:true},
    {title:'남음', done:false, mid:iso(60*26)},   // 내일 이후
  ]});
  assert.equal(placeOf(it), 'doing');
});

test('점검 모두 끝나고 마감만 내일 이후 → doing (wrapUp)', () => {
  const it = base({
    f:{due:iso(60*26)},
    subs:[{title:'점검끝', done:true, mid:iso(-60)}],   // mid는 있으나 pending 아님
  });
  assert.equal(placeOf(it), 'doing');
});

/* 시각이 없어도 손댄 업무는 doing — 판정 ①(분류 대기)보다 ③(진행 중)이 앞이다.
   '예정·대기로 떨어지던 버그' 수정(v2.5.x)의 의도를 그대로 지킨다. */
test('세부 전부 완료(마감·시각 없음) → doing — 분류 대기·예정 대기로 떨어지지 않음', () => {
  const it = base({subs:[
    {title:'a', done:true},
    {title:'b', done:true},
  ]});
  assert.equal(placeOf(it), 'doing');
});

test('미래 세부 점검만(내일 이후, 손 안 댐) → planned', () => {
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(60*48), done:false}]})), 'planned');
});

/* v2.5.18: 시각을 하나도 안 정한 업무는 '분류 대기'. 언제 할지 정하는 것이 곧 분류이고,
   '예정 · 대기'는 시각이 잡혀 있는(내일 이후) 업무 전용이다. */
test('시각 정보 전혀 없음 → inbox', () => {
  assert.equal(placeOf(base({})), 'inbox');
});

test('세부는 있는데 점검시각이 없음 → inbox', () => {
  assert.equal(placeOf(base({subs:[{title:'a', mid:'', done:false}]})), 'inbox');
});

test('손상된 due ISO → inbox (시각 없음으로 취급, F7 계열)', () => {
  assert.equal(placeOf(base({f:{due:'garbage'}})), 'inbox');
});

/* 판정 순서 ②→③→①→④ — ①(분류 대기)이 ③(진행 중) 뒤라서, 이미 손댄 업무는
   시각이 없어도 '진행 중'을 유지한다(미분류 칸으로 역행하지 않게). */
test('시각이 없어도 세부를 하나라도 완료했으면 doing 유지', () => {
  assert.equal(placeOf(base({subs:[{title:'a', mid:'', done:true}]})), 'doing');
});

/* 반대로 시각이 잡혀 있으면(완료된 세부의 점검시각도 '정해진' 것으로 친다)
   기존 판정을 그대로 탄다 — 전부 완료해도 상위 완료 전까지는 '진행 중'. */
test('완료된 세부의 점검시각만 있어도 시각 지정으로 보고 doing', () => {
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(-60), done:true}]})), 'doing');
});

test('owner 모드에서도 시각 미지정(손 안 댐)은 inbox', () => {
  setPlaceMode('owner');
  try { assert.equal(placeOf(base({})), 'inbox'); }
  finally { setPlaceMode('time'); }
});

/* 두 모드가 어긋나지 않게: 손댄 업무는 5단계에서도 분류 대기로 역행하지 않는다.
   (4단계는 ③ 진행 중, 5단계는 진행 중 칸이 없으므로 '본인 진행 · 오늘 외'.) */
test('owner 모드: 시각 미지정이어도 세부를 하나라도 완료했으면 meplan', () => {
  setPlaceMode('owner');
  try { assert.equal(placeOf(base({subs:[{title:'a', mid:'', done:true}]})), 'meplan'); }
  finally { setPlaceMode('time'); }
});

test('모드 전환 일관성: 같은 업무가 분류 대기 ↔ 진행 중을 오가지 않는다', () => {
  const touched = base({subs:[{title:'a', mid:'', done:true}]});
  assert.equal(placeOf(touched), 'doing');            // 4단계
  setPlaceMode('owner');
  try { assert.notEqual(placeOf(touched), 'inbox'); } // 5단계에서도 미분류로 안 감
  finally { setPlaceMode('time'); }
});

test('dayBounds: t0 ≤ now < t1, t0은 자정', () => {
  const [t0, t1] = dayBounds();
  const now = new Date();
  assert.ok(t0 <= now && now < t1);
  assert.equal(t0.getHours(), 0);
  assert.equal(t1.getTime() - t0.getTime(), 24*3600e3);
});

test('subMids: 완료·무시각·손상 mid 걸러냄', () => {
  const it = base({subs:[
    {title:'a', mid:iso(-10), done:false},
    {title:'b', mid:iso(10),  done:true},    // done → 제외
    {title:'c', done:false},                 // mid 없음 → 제외
    {title:'d', mid:'bad',   done:false},    // NaN → 제외
  ]});
  assert.equal(subMids(it).length, 1);
});

test('PLACE_NAME 5개 구역 전부 존재', () => {
  for(const k of ['inbox','today','doing','planned','done']) assert.ok(PLACE_NAME[k]);
});

/* ===== 시간·담당자(owner) 모드 — v2.5.0 ===== */

test('setPlaceMode: owner 이외 값은 전부 time', () => {
  setPlaceMode('owner'); assert.equal(placeMode(), 'owner');
  setPlaceMode('뭔가이상한값'); assert.equal(placeMode(), 'time');
});

test('owner 모드: staged/done/recur는 시간 모드와 동일 (inbox/done/recur)', () => {
  setPlaceMode('owner');
  assert.equal(placeOf(base({staged:true})), 'inbox');
  assert.equal(placeOf(base({done:true, f:{due:iso(-120)}})), 'done');
  assert.equal(placeOf(base({recur:{type:'dow',dow:[1],time:'09:00'}})), 'recur');
});

test('owner 모드: 본인(빈 owner) + 오늘 마감 → metoday', () => {
  setPlaceMode('owner');
  const [, t1] = dayBounds();
  const dueToday = new Date(t1.getTime() - 60e3).toISOString();
  assert.equal(placeOf(base({owner:'', f:{due:dueToday}})), 'metoday');
  assert.equal(placeOf(base({f:{due:iso(-60)}})), 'metoday');      // 지난 시각도 오늘로 침
});

test('owner 모드: 세부 담당자 김 + 오늘 점검 → othtoday (가장 이른 세부의 owner가 이김)', () => {
  setPlaceMode('owner');
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(-30), done:false, owner:'김'}]})), 'othtoday');
});

test('owner 모드: 본인 + 3일 뒤 마감 → meplan', () => {
  setPlaceMode('owner');
  assert.equal(placeOf(base({owner:'', f:{due:iso(60*72)}})), 'meplan');
});

test('owner 모드: 세부 담당자 박 + 3일 뒤 점검 → othplan', () => {
  setPlaceMode('owner');
  assert.equal(placeOf(base({subs:[{title:'a', mid:iso(60*72), done:false, owner:'박'}]})), 'othplan');
});

/* v2.5.18: 시각 미지정은 두 모드 모두 '분류 대기'. (그전에는 owner 모드에서 meplan 이었다.) */
test('owner 모드: 시각 정보 전혀 없음 → inbox (아이템 owner는 판정 제외 — v2.5.2)', () => {
  setPlaceMode('owner');
  assert.equal(placeOf(base({})), 'inbox');
  assert.equal(placeOf(base({owner:'이'})), 'inbox');           // it.owner는 레거시 보존값 — 배치에 영향 없음
  assert.equal(placeOf(base({f:{due:'garbage'}})), 'inbox');   // 손상 due도 시각 없음 취급
});

test('ownerOf: 가장 이른 미완료 세부 owner → 없으면 빈 문자열 (아이템 owner 폴백 제거 — v2.5.2)', () => {
  const it = base({owner:'상위담당', subs:[
    {title:'늦은', mid:iso(120), done:false, owner:'늦은담당'},
    {title:'이른', mid:iso(30),  done:false, owner:'이른담당'},
    {title:'완료', mid:iso(-60), done:true,  owner:'완료담당'},   // done → 제외
  ]});
  assert.equal(ownerOf(it), '이른담당');
  assert.equal(ownerOf(base({owner:'상위담당', subs:[{title:'무명', mid:iso(30), done:false, owner:''}]})), '');   // it.owner 폴백 없음
  assert.equal(ownerOf(base({subs:[{title:'무시각', done:false, owner:'무시각담당'}]})), '');   // mid 없음 → 세부 제외
  assert.equal(ownerOf(base({})), '');
});

test('owner 모드 PLACE_NAME 4개 구역 존재 + time 모드 복귀 시 기존 규칙 그대로', () => {
  for(const k of ['metoday','othtoday','meplan','othplan']) assert.ok(PLACE_NAME[k]);
  setPlaceMode('owner');
  setPlaceMode('time');
  assert.equal(placeOf(base({owner:'박', f:{due:iso(-60)}})), 'today');   // owner는 시간 모드에 영향 없음
});
