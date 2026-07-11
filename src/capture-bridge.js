/* =========================================================================
   캡처 브리지 — 미니 캡처 창(capture.html)과 메인 창 사이의 다리.
   캡처 창은 저장하지 않고 이벤트만 보낸다: 여기서 받아 captureMemo()로
   넣으면 F1 로드 게이트·저장 큐·pending-merge(main.js)가 그대로 적용된다.
   v2.31: 단축키는 Ctrl+Alt+Space 고정(변경 UI 없음 — commands.rs
   CAPTURE_SHORTCUT), 설정 모달·상주 토글 제거. 여기 남는 건 메모 라우팅과
   트레이 첫 안내 토스트뿐이다.
   주의: __TAURI__.event 는 반드시 함수 안에서 지연 접근 — store.js처럼
   최상위에서 구조분해하면 테스트 하네스(env.js)의 event 스텁보다 먼저 죽는다.
   ========================================================================= */
import {S} from './state.js';
import {STORE} from './store.js';
import {showToast} from './dom-utils.js';
import {captureMemo} from './form.js';

let trayNoticePending=false;

export function initCapture(){
  /* 캡처 창에서 온 메모 — captureMemo 가 F1 게이트·pending-merge 를 그대로 태운다 */
  window.__TAURI__.event.listen('wmhh://capture-memo', ev=>{
    const t=(ev.payload||{}).text;
    if(t) captureMemo(t);
  });

  /* X→트레이 전환 알림(Rust) — 첫 회에 한해, 창이 다시 보일 때 안내 토스트.
     숨은 창에서 바로 토스트를 띄워봐야 아무도 못 본다. */
  window.__TAURI__.event.listen('wmhh://hidden-to-tray', ()=>{
    if(S.settings.trayNoticeShown) return;
    trayNoticePending=true;
  });
  window.addEventListener('focus',()=>{
    if(!trayNoticePending) return;
    trayNoticePending=false;
    showToast('닫아도 트레이에서 계속 실행됩니다 (완전 종료는 트레이 우클릭 → 종료)');
    S.settings.trayNoticeShown=true;
    window.SETTINGS=S.settings; STORE.saveSettings(S.settings);
  });
}
