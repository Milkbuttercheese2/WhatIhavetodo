/* STORE 저장 파사드 — F1 게이트 · 단일비행 큐 · 실패 표시 · load() 핸드오프 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {STORE, setStatus} = await import('../../src/store.js');

test('F1 게이트: 로드 전 saveAll은 invoke를 한 번도 부르지 않는다', async () => {
  await env.resetS();                       // loaded=false
  await STORE.saveAll([{id:1}]);
  await env.flush();
  assert.equal(env.invokeCalls.length, 0);
});

test('정상 저장: save_all 1회, items 전달', async () => {
  await env.resetS(); S.loaded = true;
  const items = [{id:1, memo:'a'}];
  await STORE.saveAll(items);
  await STORE._saving;                      // 큐 비행 완료 대기
  const calls = env.invokeCalls.filter(c=>c.cmd==='save_all');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, {items});
});

test('단일비행 last-wins: 비행 중 들어온 A,B,C 중 실제 저장은 [첫번째, 마지막]', async () => {
  await env.resetS(); S.loaded = true;
  const gates = [];
  env.onInvoke('save_all', () => new Promise(r => gates.push(r)));
  const A=[{id:1}], B=[{id:2}], C=[{id:3}];
  STORE.saveAll(A);                         // 비행 시작
  STORE.saveAll(B);                         // pending에 덮임
  STORE.saveAll(C);                         // B를 덮음 → last-wins
  const p = STORE._saving;
  // 첫 비행 해제 → 루프가 C로 두 번째 invoke를 만들므로 gate가 다시 생긴다.
  // 새 gate가 생길 때마다 해제하며 큐가 마를 때까지 반복.
  for(let i=0; i<10 && STORE._saving; i++){
    while(gates.length) gates.shift()();
    await env.flush();
  }
  await p;
  const saved = env.invokeCalls.filter(c=>c.cmd==='save_all').map(c=>c.args.items);
  assert.deepEqual(saved, [A, C]);
});

test('저장 실패: saveStatus에 ⚠ 표시 + _saving 복구 → 다음 저장 정상', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('save_all', () => { throw new Error('disk'); });
  await STORE.saveAll([{id:1}]);
  await STORE._saving; await env.flush();
  const el = env.document.getElementById('saveStatus');
  assert.equal(el.textContent, '⚠ 저장 실패');
  assert.notEqual(el.style.display, 'none');
  assert.equal(STORE._saving, null);
  // 회복 확인
  env.onInvoke('save_all', () => undefined);
  await STORE.saveAll([{id:2}]);
  await STORE._saving;
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_all').length, 2);
});

test('setStatus(saved): 표시 숨김', () => {
  setStatus('saved');
  assert.equal(env.document.getElementById('saveStatus').style.display, 'none');
});

test('load(): S.imported 4종을 채우고 items 반환, 비배열 items는 []', async () => {
  await env.resetS();
  const state = {
    items:[{id:9}], fields:[{key:'received'}], presets:[{id:'p1'}],
    idKinds:['계약번호'], settings:{alarmOn:false},
  };
  env.onInvoke('load_all', () => state);
  const items = await STORE.load();
  assert.deepEqual(items, state.items);
  assert.equal(S.imported.fields, state.fields);
  assert.equal(S.imported.presets, state.presets);
  assert.equal(S.imported.idKinds, state.idKinds);
  assert.equal(S.imported.settings, state.settings);

  env.onInvoke('load_all', () => ({items:'nope'}));
  assert.deepEqual(await STORE.load(), []);
});

test('save*: F1 게이트 공유 + 호출 형태', async () => {
  await env.resetS();                       // loaded=false → 전부 차단
  STORE.saveFields([1]); STORE.savePresets([2]); STORE.saveIdKinds([3]); STORE.saveSettings({a:1});
  await env.flush();
  assert.equal(env.invokeCalls.length, 0);
  S.loaded = true;
  STORE.saveFields([1]); STORE.savePresets([2]); STORE.saveIdKinds([3]); STORE.saveSettings({a:1});
  await env.flush();
  assert.deepEqual(env.invokeCalls.map(c=>c.cmd),
    ['save_fields','save_presets','save_id_kinds','save_settings']);
  assert.deepEqual(env.invokeCalls[2].args, {idKinds:[3]});
});
