/* 화면 크기(확대 배율) — v2.6.0
   정규화가 잘못된 값을 등배로 떨어뜨리는지, 선택이 settings 에 저장되는지,
   그리고 100%일 때 zoom 을 비워 기본 렌더 경로를 건드리지 않는지 확인한다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {normScale, applyUiScale, initUiScale, UI_SCALES} = await import('../../src/ui-scale.js');

initUiScale();
const doc = env.document;
const modal = () => doc.getElementById('uiScaleModal');
const click = el => el.dispatchEvent(new env.window.MouseEvent('click', {bubbles:true}));

test('normScale: 목록 밖·손상된 값은 전부 100으로', () => {
  for(const v of UI_SCALES) assert.equal(normScale(v), v);
  assert.equal(normScale('115'), 115);                 // 문자열 dataset 값
  for(const bad of [undefined, null, '', 'abc', 0, -5, 99, 116, 400, NaN, Infinity])
    assert.equal(normScale(bad), 100, `${String(bad)} → 100 이어야 한다`);
});

test('applyUiScale: 100%는 zoom을 비우고, 확대는 배수로 넣는다', () => {
  applyUiScale(130);
  assert.equal(doc.body.style.zoom, '1.3');
  applyUiScale(100);
  assert.equal(doc.body.style.zoom, '', '등배에서는 zoom을 남기지 않는다');
});

test('옵션 클릭: settings.uiScale 저장 + save_settings 호출 + 선택 표시', async () => {
  await env.resetS(); S.loaded = true;
  click(doc.getElementById('uiScaleBtn'));
  assert.ok(modal().classList.contains('on'), '메뉴 버튼으로 모달이 열린다');

  click(modal().querySelector('.bm-opt[data-scale="115"]'));
  assert.equal(S.settings.uiScale, 115);
  assert.equal(doc.body.style.zoom, '1.15');
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, 1);
  assert.ok(modal().querySelector('.bm-opt[data-scale="115"]').classList.contains('on'));
  assert.ok(modal().classList.contains('on'), '선택해도 모달은 열어둔다');

  // 같은 값을 다시 눌러도 중복 저장하지 않는다
  click(modal().querySelector('.bm-opt[data-scale="115"]'));
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='save_settings').length, 1);
});

test('배경 클릭·닫기 버튼으로 닫힌다', async () => {
  await env.resetS();
  click(doc.getElementById('uiScaleBtn'));
  click(doc.getElementById('uiScaleClose'));
  assert.equal(modal().classList.contains('on'), false);

  click(doc.getElementById('uiScaleBtn'));
  click(modal());                                       // 배경(모달 바깥) 클릭
  assert.equal(modal().classList.contains('on'), false);
});

test('저장값이 없거나 손상돼도 등배로 복원된다', async () => {
  await env.resetS();
  assert.equal(applyUiScale(S.settings.uiScale), 100);  // 기본 settings엔 uiScale 없음
  S.settings.uiScale = 'zzz';
  assert.equal(applyUiScale(S.settings.uiScale), 100);
});
