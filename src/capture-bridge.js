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
import {captureMemo, openForm} from './form.js';

let trayNoticePending=false;
let draftSaveTimer=null;

/* 캡처 초안 → settings.captureDraft. 앱이 초안을 남긴 채 꺼지면(전원 차단 포함)
   다음 실행의 초기 로드(main.js flushCaptureDraft)가 분류 대기로 자동 등록한다.
   F1 게이트: 로드 전에는 저장하지 않는다(빈 설정으로 덮어쓰기 방지) — 그 사이
   초안은 캡처 창 textarea에 그대로 살아 있으므로 유실이 아니다. */
function saveDraft(text){
  S.settings.captureDraft=String(text??'');
  window.SETTINGS=S.settings;
  if(!S.loaded) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer=setTimeout(()=>STORE.saveSettings(S.settings),300);
}

export function initCapture(){
  /* 캡처 창에서 온 메모 — captureMemo 가 F1 게이트·pending-merge 를 그대로 태운다 */
  window.__TAURI__.event.listen('wmhh://capture-memo', ev=>{
    const t=(ev.payload||{}).text;
    if(t){
      captureMemo(t);
      /* v2.5.11: 등록과 동시에 초안을 '즉시'(디바운스 없이) 비워 저장한다.
         기존엔 별도 300ms 디바운스 capture-draft('') 에만 의존해, 등록 직후 ~300ms 안에
         앱이 꺼지면 다음 실행의 초안 회수가 같은 메모를 한 번 더 등록(중복)하던 문제. */
      S.settings.captureDraft=''; window.SETTINGS=S.settings; STORE.saveSettings(S.settings);
    }
  });

  /* 캡처 창 초안 흘려받기 (입력 시마다·숨김 직전 플러시) */
  window.__TAURI__.event.listen('wmhh://capture-draft', ev=>{
    saveDraft((ev.payload||{}).text);
  });

  /* 캡처 검색 모드에서 업무 클릭 → 메인 창에서 양식 열기 */
  window.__TAURI__.event.listen('wmhh://open-item', ev=>{
    const id=(ev.payload||{}).id;
    const it=S.items.find(x=>x.id===id);
    if(it && !it.recur) openForm(it);   // 부모(주기 정의)는 양식으로 열지 않음
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
