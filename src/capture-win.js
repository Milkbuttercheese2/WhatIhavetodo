/* =========================================================================
   미니 캡처 창 로직 — 이 파일은 capture 웹뷰에서만 돈다.
   메인 앱 모듈(state.js/store.js 등)을 import하지 말 것: store.js의 최상위
   __TAURI__ 구조분해가 테스트를 깨고, 모듈 상태가 두 웹뷰에서 이중 실행된다.
   저장도 직접 하지 않는다 — 메모 텍스트를 이벤트로 메인 창에 던지면
   메인 창의 captureMemo()가 F1 로드 게이트·저장 큐를 그대로 태운다.
   ========================================================================= */
let submitting=false;                       // 등록 플래시 중 blur로 조기 숨김 방지
const hideWin=()=>window.__TAURI__.window.getCurrentWindow().hide();   // 지연 접근 (테스트 하네스 제약)

/* ---- 입력 길이에 따라 창을 아래로 자동 확장 ----
   개행(Enter)을 허용하면서 창이 안 늘면 윗줄이 가려진다 → 내용에 맞춰 창 높이를 키운다.
   최대 MAX_LINES 를 넘으면 그때부터 textarea 내부 스크롤. 지오메트리(px)는 capture.html CSS와
   맞물려 있다: 카드 세로패딩 24 + 카드 최소높이 60, body 세로패딩 48(=24*2), 한 줄 = LINE. */
const WIN_W=640, LINE=24, MAX_LINES=7, CARD_VPAD=24, CARD_MIN=60, BODY_VPAD=48;
let lastWinH=0;
function autosizeWin(inp){
  inp.style.height='auto';
  const inpH=Math.min(inp.scrollHeight, LINE*MAX_LINES);
  inp.style.height=inpH+'px';
  const winH=Math.max(CARD_MIN, inpH+CARD_VPAD)+BODY_VPAD;
  if(winH===lastWinH) return;               // 높이 안 바뀌면 setSize 스킵
  lastWinH=winH;
  try{ const w=window.__TAURI__.window;
       w.getCurrentWindow().setSize(new w.LogicalSize(WIN_W,winH)).catch(()=>{}); }catch{}
}
/* 메인 창에 "현재 테마 알려줘" 요청 — 응답(wmhh://theme)이 오면 data-theme 갱신.
   메인이 아직 안 떴어도 CSS의 prefers-color-scheme 가 기본값을 잡아준다. */
const askTheme=()=>{ try{ window.__TAURI__.event.emitTo('main','wmhh://capture-hello',{}).catch(()=>{}); }catch{} };

export function initCaptureWin(){
  const inp=document.getElementById('cap-inp');
  /* 메인 앱의 라이트/다크 설정을 그대로 따라간다 (독립 웹뷰라 이벤트로만 받는다) */
  window.__TAURI__.event.listen('wmhh://theme',ev=>{
    const t=(ev.payload||{}).theme;
    if(t==='light'||t==='dark') document.documentElement.dataset.theme=t;
  });
  askTheme();
  const resize=()=>autosizeWin(inp);
  inp.addEventListener('input',resize);           // 타이핑·개행마다 창 높이 맞춤
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 오등록 방지
    if(e.key==='Escape'){ e.preventDefault(); inp.value=''; resize(); hideWin(); return; }
    /* 메인 바로 입력(form.js)과 동일: Ctrl(⌘)+Enter=등록, 맨 Enter=줄바꿈 */
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
      e.preventDefault();
      const t=inp.value.trim(); if(!t){ hideWin(); return; }
      window.__TAURI__.event.emitTo('main','wmhh://capture-memo',{text:t}).catch(()=>{});
      inp.value=''; resize();                     // 등록 후 창을 한 줄 높이로 되돌림
      submitting=true; document.body.classList.add('flash');
      setTimeout(()=>{ document.body.classList.remove('flash'); submitting=false; hideWin(); },400);
    }
  });
  /* 포커스를 잃으면 숨김 — 드래프트는 유지(전화 중 끊긴 메모 보호). Esc만 비운다 */
  window.addEventListener('blur',()=>{ if(!submitting) hideWin(); });
  window.addEventListener('focus',()=>{ inp.focus(); const n=inp.value.length; inp.setSelectionRange(n,n); resize(); askTheme(); });
  inp.focus(); resize();
}
