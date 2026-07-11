/* =========================================================================
   미니 캡처 창 로직 — 이 파일은 capture 웹뷰에서만 돈다.
   메인 앱 모듈(state.js/store.js 등)을 import하지 말 것: store.js의 최상위
   __TAURI__ 구조분해가 테스트를 깨고, 모듈 상태가 두 웹뷰에서 이중 실행된다.
   저장도 직접 하지 않는다 — 메모 텍스트를 이벤트로 메인 창에 던지면
   메인 창의 captureMemo()가 F1 로드 게이트·저장 큐를 그대로 태운다.
   ========================================================================= */
let submitting=false;                       // 등록 플래시 중 blur로 조기 숨김 방지
const hideWin=()=>window.__TAURI__.window.getCurrentWindow().hide();   // 지연 접근 (테스트 하네스 제약)

export function initCaptureWin(){
  const inp=document.getElementById('cap-inp');
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 오등록 방지
    if(e.key==='Escape'){ e.preventDefault(); inp.value=''; hideWin(); return; }
    /* 메인 바로 입력(form.js)과 동일: Ctrl(⌘)+Enter=등록, 맨 Enter=줄바꿈 */
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
      e.preventDefault();
      const t=inp.value.trim(); if(!t){ hideWin(); return; }
      window.__TAURI__.event.emitTo('main','wmhh://capture-memo',{text:t}).catch(()=>{});
      inp.value=''; submitting=true; document.body.classList.add('flash');
      setTimeout(()=>{ document.body.classList.remove('flash'); submitting=false; hideWin(); },400);
    }
  });
  /* 포커스를 잃으면 숨김 — 드래프트는 유지(전화 중 끊긴 메모 보호). Esc만 비운다 */
  window.addEventListener('blur',()=>{ if(!submitting) hideWin(); });
  window.addEventListener('focus',()=>{ inp.focus(); const n=inp.value.length; inp.setSelectionRange(n,n); });
  inp.focus();
}
