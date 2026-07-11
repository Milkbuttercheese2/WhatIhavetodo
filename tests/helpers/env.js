/* =========================================================================
   테스트 환경 헬퍼 — jsdom + Tauri 가짜 invoke + S 리셋.
   주의: src 모듈은 반드시 setupEnv() "이후" await import(...) 할 것 —
   store.js가 최상위에서 window.__TAURI__.core를 구조분해하므로,
   정적 import는 호이스팅되어 전역 설정보다 먼저 실행돼 터진다.
   ========================================================================= */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {JSDOM} from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

export function setupEnv({html} = {}){
  // 스크립트는 기본적으로 실행되지 않는다 — vendor/xlsx와 main.js는 비활성 상태
  // html 옵션: 'capture.html' 등 다른 src 페이지 위에서 테스트할 때
  const dom = new JSDOM(html ? readFileSync(path.join(ROOT, 'src', html), 'utf8') : HTML,
    {url: 'http://localhost/'});
  const {window} = dom;

  /* ---- Tauri IPC 가짜 ---- */
  const invokeCalls = [];                      // [{cmd, args}]
  const handlers = new Map();                  // cmd -> (args) => result|Promise|throw
  const fakeInvoke = (cmd, args) => {
    invokeCalls.push({cmd, args});
    try { const h = handlers.get(cmd); return Promise.resolve(h ? h(args) : undefined); }
    catch (e) { return Promise.reject(e); }
  };
  /* ---- Tauri 이벤트/창 가짜 (capture-bridge.js·capture-win.js용) ---- */
  const eventListeners = new Map();            // name -> [fn]
  const emitted = [];                          // [{target?, name, payload}] + [{hide:true}]
  window.__TAURI__ = {
    core: {invoke: fakeInvoke},
    app: {getVersion: async () => '2.3.0'},
    event: {
      listen: async (name, fn) => {
        if(!eventListeners.has(name)) eventListeners.set(name, []);
        eventListeners.get(name).push(fn);
        return () => {};
      },
      emit:   async (name, payload) => { emitted.push({name, payload}); },
      emitTo: async (target, name, payload) => { emitted.push({target, name, payload}); },
    },
    window: {getCurrentWindow: () => ({hide: async () => { emitted.push({hide:true}); }})},
  };

  /* ---- 제어 가능한 다이얼로그 (jsdom 기본은 미구현 스텁) ---- */
  const alerts = [];
  const confirmQueue = [];                     // 호출마다 shift, 비면 기본 true
  window.alert   = m => { alerts.push(String(m)); };
  window.confirm = () => confirmQueue.length ? confirmQueue.shift() : true;
  window.prompt  = () => null;

  /* ---- bare 식별자 전역 (src 모듈이 window./ 없이 참조) ----
     의도적 부재: Notification(askNotify가 'Notification' in window 가드),
     AudioContext(beep()이 try/catch로 조용히 무시), XLSX */
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.alert = window.alert;
  globalThis.confirm = window.confirm;
  globalThis.prompt = window.prompt;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;

  return {
    window, document: window.document,
    invokeCalls, alerts, emitted,
    onInvoke: (cmd, fn) => handlers.set(cmd, fn),
    answerConfirm: (...a) => confirmQueue.push(...a),
    /* 등록된 listen 콜백에 이벤트 주입 — Rust/다른 웹뷰가 보낸 것처럼 */
    fireEvent: (name, payload) => {
      (eventListeners.get(name) || []).forEach(fn => fn({event: name, payload}));
    },
    /* 테스트 간 S 싱글턴 복원 (state.js가 아직 import 전이어도 되도록 async) */
    async resetS(){
      const {S, CORE_FIELDS, DEFAULT_ID_KINDS, DEFAULT_SETTINGS} = await import('../../src/state.js');
      S.items = []; S.fields = JSON.parse(JSON.stringify(CORE_FIELDS));
      S.presets = []; S.idKinds = DEFAULT_ID_KINDS.slice();
      S.settings = Object.assign({}, DEFAULT_SETTINGS);
      S.recurDefs = [];
      S.loaded = false; S.lastId = 0;
      S.imported = {fields:null, presets:null, idKinds:null, settings:null, recurDefs:null};
      invokeCalls.length = 0; alerts.length = 0; confirmQueue.length = 0; emitted.length = 0;
      // 파일 내 이전 테스트가 남긴 UI 상태 정리
      const g = id => window.document.getElementById(id);
      for(const id of ['formPanel','alarmBg','presetModal']){ const el=g(id); if(el) el.classList.remove('on'); }
    },
    /* async 클릭 핸들러(backup.js 등) 완료 대기 — setImmediate는 mock.timers
       모킹 목록에 없어 모의 타이머 아래에서도 실제로 동작한다 */
    flush: async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); },
  };
}
