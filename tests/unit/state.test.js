/* S 싱글턴 · newId(F12) · migrateItem · reconcileCore */
import {test} from 'node:test';
import assert from 'node:assert/strict';

// reconcileCore가 window.FIELDS에 미러를 쓰므로 최소 스텁 (import 전에)
globalThis.window = globalThis.window || {};

const {S, newId, migrateItem, reconcileCore, CORE_FIELDS} = await import('../../src/state.js');

test('newId: F12 — 같은 ms 안에서도 단조 증가', () => {
  S.lastId = Date.now() + 10_000;               // 항상 t <= lastId가 되도록 시드
  const ids = Array.from({length: 100}, () => newId());
  for(let i=1;i<ids.length;i++) assert.equal(ids[i], ids[i-1]+1);
});

test('newId: 시드 0이면 Date.now() 근처에서 시작', () => {
  S.lastId = 0;
  const before = Date.now();
  const id = newId();
  assert.ok(id >= before && id <= Date.now()+1);
});

test('migrateItem: 구형(v5 이전) 픽스처 전체 변환', () => {
  S.lastId = 0;
  const old = {
    id: 1000, title: '옛제목',
    f: {who:'김담당', org:'모부서', phone:'010-0000-0000', mid:'x', notice:'공고-1', sr:'SR-2', due:'2026-07-10T09:00:00.000Z'},
    subs: [{title:'세부1'}],
  };
  const it = migrateItem(old);
  // 관련인 승계
  assert.deepEqual(it.contacts, [{who:'김담당', org:'모부서', phone:'010-0000-0000'}]);
  assert.ok(!('who' in it.f) && !('org' in it.f) && !('phone' in it.f) && !('mid' in it.f));
  // notice/sr → ids
  assert.deepEqual(it.ids, [{kind:'입찰공고번호', val:'공고-1'}, {kind:'SR번호', val:'SR-2'}]);
  assert.ok(!('notice' in it.f) && !('sr' in it.f));
  // title → memo, title 제거
  assert.equal(it.memo, '옛제목');
  assert.ok(!('title' in it));
  // due는 보존
  assert.equal(it.f.due, old.f.due);
  // F12: sub id 보정 + al 초기화
  assert.equal(typeof it.subs[0].id, 'number');
  assert.deepEqual(it.subs[0].al, {});
  // lastId 시딩: 기존 최대 id 이상
  assert.ok(S.lastId >= Math.max(it.id, it.subs[0].id));
});

test('migrateItem: 기존 memo·contacts·sub id/al은 건드리지 않음', () => {
  const it = migrateItem({
    id: 5, memo:'이미 있는 메모', title:'무시될 제목',
    contacts:[{who:'갑'}],
    f:{who:'을'},                                  // contacts 있으면 승계 안 함
    subs:[{id:77, title:'s', al:{mid:true}}],
  });
  assert.equal(it.memo, '이미 있는 메모');
  assert.deepEqual(it.contacts, [{who:'갑'}]);
  assert.equal(it.subs[0].id, 77);
  assert.deepEqual(it.subs[0].al, {mid:true});
});

test('reconcileCore: 커스텀 유지, 레거시 키 제거, 코어 강제 builtin/on', () => {
  S.fields = [
    {key:'received', label:'변조된 접수', on:false, builtin:false},
    {key:'who', label:'레거시'},                   // 제거 대상
    {key:'custom1', label:'사용자 필드', on:true},  // 유지 대상
  ];
  reconcileCore();
  const keys = S.fields.map(f=>f.key);
  assert.deepEqual(keys, ['received', 'due', 'custom1']);
  const rec = S.fields.find(f=>f.key==='received');
  assert.equal(rec.on, true); assert.equal(rec.builtin, true);
  assert.equal(rec.label, '접수시각');               // 코어 정의가 항상 이김 (변조 무시)
  assert.equal(window.FIELDS, S.fields);            // 미러 갱신
  assert.equal(CORE_FIELDS.length, 2);
});
