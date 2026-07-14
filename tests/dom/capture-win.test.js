/* 미니 캡처 창 — Ctrl+Enter 등록·Enter 개행·IME 가드·Esc·blur 드래프트 유지
   capture.html 위에서 돌고, capture-win.js는 앱 모듈을 import하지 않는다. */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv({html: 'capture.html'});
const {initCaptureWin} = await import('../../src/capture-win.js');
initCaptureWin();

const inp = env.document.getElementById('cap-inp');
const body = env.document.body;
const key = init => inp.dispatchEvent(new env.window.KeyboardEvent('keydown', Object.assign({bubbles:true, cancelable:true}, init)));
const emits = () => env.emitted.filter(e=>e.name==='wmhh://capture-memo');
const hides = () => env.emitted.filter(e=>e.hide);
const reset = () => { env.emitted.length = 0; inp.value=''; body.classList.remove('flash'); };

test('Ctrl+Enter: main으로 emitTo + 입력 클리어 + 플래시, 400ms 후 플래시 해제 + 숨김', () => {
  reset();
  inp.value = '  긴급 회신  ';
  key({key:'Enter', ctrlKey:true});
  assert.equal(emits().length, 1);
  assert.deepEqual(emits()[0], {target:'main', name:'wmhh://capture-memo', payload:{text:'긴급 회신'}});
  assert.equal(inp.value, '');
  assert.ok(body.classList.contains('flash'));
  assert.equal(hides().length, 0);
  // 플래시(등록 처리) 중의 blur는 조기 숨김을 유발하지 않는다
  env.window.dispatchEvent(new env.window.Event('blur'));
  assert.equal(hides().length, 0);
  mock.timers.tick(400);
  assert.equal(body.classList.contains('flash'), false);
  assert.equal(hides().length, 1);
});

test('맨 Enter는 등록하지 않는다 (개행 — 메인 바로 입력과 동일 규칙)', () => {
  reset();
  inp.value = '여러 줄 메모';
  key({key:'Enter'});
  assert.equal(emits().length, 0);
  assert.equal(inp.value, '여러 줄 메모');
});

test('IME 조합 중(isComposing) Ctrl+Enter는 무시', () => {
  reset();
  inp.value = '한글 조합중';
  const e = new env.window.KeyboardEvent('keydown', {key:'Enter', ctrlKey:true, bubbles:true, cancelable:true});
  Object.defineProperty(e, 'isComposing', {value: true});
  inp.dispatchEvent(e);
  assert.equal(emits().length, 0);
  assert.equal(inp.value, '한글 조합중');
});

test('빈 입력에서 Ctrl+Enter → 발신 없이 숨기기만', () => {
  reset();
  inp.value = '   ';
  key({key:'Enter', ctrlKey:true});
  assert.equal(emits().length, 0);
  assert.equal(hides().length, 1);
});

const drafts = () => env.emitted.filter(e=>e.name==='wmhh://capture-draft');

test('Esc: 내용을 유지한 채 숨기고 초안을 플러시 (v3.1.0 — 삭제는 사용자만)', () => {
  reset();
  inp.value = '이어서 쓸 메모';
  key({key:'Escape'});
  assert.equal(inp.value, '이어서 쓸 메모');       // 절대 지우지 않는다
  assert.equal(hides().length, 1);
  assert.equal(emits().length, 0);
  assert.equal(drafts().at(-1).payload.text, '이어서 쓸 메모');   // 초안 저장 플러시
});

test('blur: 숨기되 드래프트는 유지 + 초안 플러시', () => {
  reset();
  inp.value = '전화 중 끊긴 메모';
  env.window.dispatchEvent(new env.window.Event('blur'));
  assert.equal(hides().length, 1);
  assert.equal(inp.value, '전화 중 끊긴 메모');
  assert.equal(drafts().at(-1).payload.text, '전화 중 끊긴 메모');
});

test('Ctrl+Enter 등록 시 초안을 빈 값으로 플러시 (재시작 중복 등록 방지)', () => {
  reset();
  inp.value = '등록할 메모';
  key({key:'Enter', ctrlKey:true});
  assert.equal(drafts().at(-1).payload.text, '');
  mock.timers.tick(400);
});

test('입력 시 초안이 디바운스 후 전송된다', () => {
  reset();
  inp.value = '타이핑 중';
  inp.dispatchEvent(new env.window.Event('input', {bubbles:true}));
  assert.equal(drafts().length, 0);               // 아직 (400ms 디바운스)
  mock.timers.tick(400);
  assert.equal(drafts().at(-1).payload.text, '타이핑 중');
});
