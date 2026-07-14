/* 렌더 — 4열 배치 · 완료 뷰 · 카드 위임 상호작용 · 검색 · 지남 스트립 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {render, renderDone, initRender} = await import('../../src/render.js');
const {initForm} = await import('../../src/form.js');
const {initToast} = await import('../../src/dom-utils.js');
initForm();          // 카드 클릭 → openForm 경로에 필요
initRender();
initToast();         // 삭제 실행취소(#toast-undo) 경로에 필요

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();
const mk = o => Object.assign({id:newId(), memo:'m', done:false, staged:false, f:{}, contacts:[], ids:[], subs:[], al:{}}, o);

test('render: placeOf에 따라 4열 분배 + 카운트 + empty 문구', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(
    mk({memo:'대기건', staged:true}),
    mk({memo:'지남건', f:{due:iso(-60)}}),
    mk({memo:'진행건', subs:[{id:newId(), title:'a', done:true}, {id:newId(), title:'b', done:false, mid:iso(60*26)}]}),
  );
  render();
  assert.equal($('c-inbox').textContent, '1');
  assert.equal($('c-today').textContent, '1');
  assert.equal($('c-doing').textContent, '1');
  assert.equal($('c-planned').textContent, '0');
  assert.ok($('col-inbox').textContent.includes('대기건'));
  assert.ok($('col-today').textContent.includes('지남건'));
  assert.ok($('col-doing').textContent.includes('진행건'));
  assert.ok($('col-planned').querySelector('.empty'));
});

test('done 아이템은 보드 제외, renderDone에 표시', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'끝난 일', done:true, doneAt:Date.now()}));
  render();
  for(const k of ['inbox','today','doing','planned'])
    assert.ok(!$('col-'+k).textContent.includes('끝난 일'));
  assert.equal($('done-count').textContent, '1');
  assert.ok($('col-done').textContent.includes('끝난 일'));
});

test('완료 업무는 마감이 지났어도 빨간 알람 점(ad-ring)을 표시하지 않음', async () => {
  await env.resetS(); S.loaded = true;
  // 마감이 이미 지난 완료 업무 — 알람 확인 기록(al) 없음
  S.items.push(mk({memo:'지난 완료건', done:true, doneAt:Date.now(), f:{due:iso(-120)}}));
  render();
  assert.ok($('col-done').textContent.includes('지난 완료건'));
  assert.ok(!$('col-done').innerHTML.includes('ad-ring'));   // 울림(빨강) 점 없음
  assert.ok(!$('col-done').innerHTML.includes('adot'));      // 알람 점 자체가 없음
});

test('카드 클릭 → 양식 오픈 + 메모 채워짐', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'클릭 대상', staged:true}));
  render();
  $('col-inbox').querySelector('[data-open]').click();
  assert.ok($('formPanel').classList.contains('on'));
  assert.equal($('fm-memo').value, '클릭 대상');
  $('formPanel').classList.remove('on');
});

test('체크박스 클릭 → done 토글 + doneAt + save_all', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'완료 처리', staged:true}));
  render();
  $('col-inbox').querySelector('.chk[data-id]').click();
  await env.flush();
  assert.equal(S.items[0].done, true);
  assert.equal(typeof S.items[0].doneAt, 'number');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('삭제 클릭 → splice + 실행취소 토스트 + save_all', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'삭제 대상', staged:true}));
  render();
  $('col-inbox').querySelector('.del[data-del]').click();
  await env.flush();
  assert.equal(S.items.length, 0);
  assert.equal($('toast-msg').textContent, '업무를 삭제했습니다');
  assert.equal($('toast-undo').style.display, 'inline-block');
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
});

test('삭제 실행취소 → 원래 인덱스로 복원 + 재저장', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'앞건', staged:true}), mk({memo:'가운데건', staged:true}), mk({memo:'뒷건', staged:true}));
  const midId = S.items[1].id;
  render();
  $('col-inbox').querySelector(`.del[data-del="${midId}"]`).click();
  await env.flush();
  assert.deepEqual(S.items.map(x=>x.memo), ['앞건','뒷건']);
  env.invokeCalls.length = 0;
  $('toast-undo').click();
  await env.flush();
  assert.deepEqual(S.items.map(x=>x.memo), ['앞건','가운데건','뒷건']);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='save_all'));
  assert.ok($('col-inbox').textContent.includes('가운데건'));
});

test('검색: 보드 필터 + 결과 없음 문구', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'사과 관련', staged:true}), mk({memo:'바나나 관련', staged:true}));
  const search = $('search');
  search.value = '사과';
  search.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.ok($('col-inbox').textContent.includes('사과 관련'));
  assert.ok(!$('col-inbox').textContent.includes('바나나 관련'));
  search.value = '없는말';
  search.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.ok($('col-inbox').textContent.includes('검색 결과가 없습니다'));
  search.value = '';
  search.dispatchEvent(new env.window.Event('input', {bubbles:true}));
});

test('완료 탭 검색(dq)은 보드 검색과 독립', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push(mk({memo:'완료A', done:true}), mk({memo:'완료B', done:true}));
  renderDone();
  const ds = $('done-search');
  ds.value = '완료a';                      // haystack은 소문자 비교
  ds.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.ok($('col-done').textContent.includes('완료A'));
  assert.ok(!$('col-done').textContent.includes('완료B'));
  ds.value = '';
  ds.dispatchEvent(new env.window.Event('input', {bubbles:true}));
});
