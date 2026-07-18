/* 렌더 — 4열 배치 · 완료 뷰 · 카드 위임 상호작용 · 검색 · 지남 스트립 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S, newId} = await import('../../src/state.js');
const {render, renderDone, initRender} = await import('../../src/render.js');
const {setPlaceMode} = await import('../../src/placement.js');
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

test('owner 모드: 5열 분배 + 담당 태그 + 보드 표시 전환 (v2.5.0)', async () => {
  await env.resetS(); S.loaded = true;
  try{
    setPlaceMode('owner');
    S.items.push(
      mk({memo:'본인오늘건', f:{due:iso(-60)}}),
      mk({memo:'타인오늘건', owner:'김', f:{due:iso(-60)}}),
      mk({memo:'본인예정건', f:{due:iso(60*72)}}),
      mk({memo:'타인예정건', subs:[{id:newId(), title:'s', mid:iso(60*72), done:false, owner:'박'}]}),
      mk({memo:'대기건', staged:true}),
    );
    render();
    assert.equal($('c5-inbox').textContent, '1');
    assert.equal($('c5-metoday').textContent, '1');
    assert.equal($('c5-othtoday').textContent, '1');
    assert.equal($('c5-meplan').textContent, '1');
    assert.equal($('c5-othplan').textContent, '1');
    assert.ok($('col5-metoday').textContent.includes('본인오늘건'));
    assert.ok($('col5-othtoday').textContent.includes('타인오늘건'));
    assert.ok($('col5-othtoday').innerHTML.includes('#담당:'));       // 타인 카드에만 담당 배지 (v2.5.1: #담당: 형식)
    assert.ok($('col5-othtoday').textContent.includes('#담당:김'));
    assert.ok(!$('col5-metoday').innerHTML.includes('tag owner'));
    assert.ok($('col5-othplan').textContent.includes('타인예정건'));  // 세부 owner도 타인 판정
    // 보드 탭 활성 상태에서는 5열 보드만 보인다
    assert.equal($('view-board5').style.display, 'grid');
    assert.equal($('view-board').style.display, 'none');
  }finally{ setPlaceMode('time'); }
  render();
  assert.equal($('view-board').style.display, 'grid');
  assert.equal($('view-board5').style.display, 'none');
});

test('카드 시각 표시 정책: 마감보다 앞서는 세부가 있으면 세부 시각만, 아니면 #마감만 (v2.5.1)', async () => {
  await env.resetS(); S.loaded = true;
  // 전부 지난 시각으로 고정 — 자정 경계 플레이크 없이 항상 today 열
  const a = mk({memo:'세부가앞섬', f:{due:iso(-60)},  subs:[{id:newId(), title:'먼저점검', mid:iso(-120), done:false}]});
  const b = mk({memo:'마감이앞섬', f:{due:iso(-120)}, subs:[{id:newId(), title:'나중점검', mid:iso(-60), done:false}]});
  const c = mk({memo:'세부다완료', f:{due:iso(-30)},  subs:[{id:newId(), title:'끝난점검', mid:iso(-60), done:true}]});
  S.items.push(a, b, c);
  render();
  const card = id => $('col-today').querySelector(`[data-open="${id}"]`);
  // a: 세부 점검 시각(#점검)만 — #마감 태그 없음
  assert.ok(card(a.id).innerHTML.includes('#점검:'));
  assert.ok(!card(a.id).innerHTML.includes('#마감:'));
  // b: 세부 제목 줄은 남되 시각은 #마감만
  assert.ok(card(b.id).textContent.includes('나중점검'));
  assert.ok(!card(b.id).innerHTML.includes('#점검:'));
  assert.ok(card(b.id).innerHTML.includes('#마감:'));
  // c: pending 세부 없음 → #마감만
  assert.ok(!card(c.id).querySelector('.card-subline'));
  assert.ok(!card(c.id).innerHTML.includes('#점검:'));
  assert.ok(card(c.id).innerHTML.includes('#마감:'));
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
