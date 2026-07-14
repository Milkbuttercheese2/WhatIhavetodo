/* =========================================================================
   미니 캡처 창 로직 — 이 파일은 capture 웹뷰에서만 돈다.
   메인 앱 모듈(state.js/store.js 등)을 import하지 말 것: store.js의 최상위
   __TAURI__ 구조분해가 테스트를 깨고, 모듈 상태가 두 웹뷰에서 이중 실행된다.
   저장도 직접 하지 않는다 — 메모 텍스트를 이벤트로 메인 창에 던지면
   메인 창의 captureMemo()가 F1 로드 게이트·저장 큐를 그대로 태운다.

   v2.4.0 동작:
   - 메모 모드(기본): Ctrl+Enter 등록, Esc/blur = 숨김만 (내용은 절대 안 지움 —
     지우는 건 사용자 몫). 입력할 때마다 초안을 메인 창으로 흘려보내
     settings.captureDraft로 저장 → 앱이 꺼져도 다음 실행 때 분류 대기로 자동 등록.
   - Alt: 검색 모드 토글 (Spotlight식). 내 업무(quick_search)를 검색해
     클릭하면 메인 창에서 열린다. 메모 초안은 별도 입력칸이라 검색해도 남는다.
   ========================================================================= */
let submitting=false;                       // 등록 플래시 중 blur로 조기 숨김 방지
let mode='memo';                            // 'memo' | 'search'
let draftTimer=null, searchTimer=null, searchSeq=0;

const hideWin=()=>window.__TAURI__.window.getCurrentWindow().hide();   // 지연 접근 (테스트 하네스 제약)
const invoke=(cmd,args)=>window.__TAURI__.core.invoke(cmd,args);
const $id=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* 초안을 메인 창으로 (메인이 settings.captureDraft에 저장) — 등록/삭제 포함 모든 변경 */
function sendDraft(text){
  window.__TAURI__.event.emitTo('main','wmhh://capture-draft',{text:String(text??'')}).catch(()=>{});
}

function setMode(m){
  mode=m;
  const search=m==='search';
  document.body.classList.toggle('search',search);
  $id('cap-inp').style.display=search?'none':'';
  $id('cap-search').style.display=search?'':'none';
  $id('cap-results').style.display=search?'flex':'none';
  invoke('resize_capture',{height:search?406:126}).catch(()=>{});   // 메모 모드 = 낮은 바, 검색 모드 = 목록 높이
  const t=search?$id('cap-search'):$id('cap-inp');
  t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  if(search) runSearch($id('cap-search').value.trim());
}

async function runSearch(q){
  const seq=++searchSeq;
  const iw=$id('cap-items');
  if(!q){ iw.innerHTML='<div class="cap-empty">검색어를 입력하세요</div>'; return; }
  const items=await invoke('quick_search',{query:q}).catch(()=>[]);
  if(seq!==searchSeq) return;               // 그 사이 새 검색어 입력됨
  iw.innerHTML=items.length?items.map(h=>
    `<div class="cap-hit${h.done?' done':''}" data-item="${h.id}">${h.done?'[완료] ':''}${esc(h.memo||'(메모 없음)')}</div>`
  ).join(''):'<div class="cap-empty">일치하는 업무 없음</div>';
}

export function initCaptureWin(){
  const inp=$id('cap-inp');
  inp.addEventListener('input',()=>{
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>sendDraft(inp.value),400);
  });
  inp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;   // 한글 IME 조합 중 오등록 방지
    if(e.key==='Escape'){ e.preventDefault(); sendDraft(inp.value); hideWin(); return; }   // 내용 유지!
    /* 메인 바로 입력(form.js)과 동일: Ctrl(⌘)+Enter=등록, 맨 Enter=줄바꿈 */
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
      e.preventDefault();
      const t=inp.value.trim(); if(!t){ hideWin(); return; }
      window.__TAURI__.event.emitTo('main','wmhh://capture-memo',{text:t}).catch(()=>{});
      inp.value=''; clearTimeout(draftTimer); sendDraft('');   // 등록됐으니 초안 비움
      submitting=true; document.body.classList.add('flash');
      setTimeout(()=>{ document.body.classList.remove('flash'); submitting=false; hideWin(); },400);
    }
  });

  const searchInp=$id('cap-search');
  searchInp.addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229) return;
    if(e.key==='Escape'){ e.preventDefault(); setMode('memo'); hideWin(); return; }
  });
  searchInp.addEventListener('input',()=>{
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>runSearch(searchInp.value.trim()),250);
  });

  /* Alt 단독 키로 메모 ↔ 검색 토글 (양쪽 모드 공통) */
  document.addEventListener('keydown',e=>{
    if(e.key==='Alt'&&!e.repeat){ e.preventDefault(); setMode(mode==='memo'?'search':'memo'); }
  });

  /* 검색 결과 클릭 — 업무를 메인 창에서 연다 */
  $id('cap-results').addEventListener('click',e=>{
    const ih=e.target.closest('[data-item]');
    if(ih){
      window.__TAURI__.event.emitTo('main','wmhh://open-item',{id:Number(ih.dataset.item)}).catch(()=>{});
      invoke('focus_main_window').catch(()=>{});
      hideWin(); return;
    }
  });

  /* 포커스를 잃으면 숨김 — 초안은 유지 + 저장 플러시 */
  window.addEventListener('blur',()=>{ if(!submitting){ sendDraft(inp.value); hideWin(); } });
  window.addEventListener('focus',()=>{
    const t=mode==='search'?searchInp:inp;
    t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  });
  inp.focus();
}
