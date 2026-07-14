/* =========================================================================
   미니 캡처 창 로직 — 이 파일은 capture 웹뷰에서만 돈다.
   메인 앱 모듈(state.js/store.js 등)을 import하지 말 것: store.js의 최상위
   __TAURI__ 구조분해가 테스트를 깨고, 모듈 상태가 두 웹뷰에서 이중 실행된다.
   저장도 직접 하지 않는다 — 메모 텍스트를 이벤트로 메인 창에 던지면
   메인 창의 captureMemo()가 F1 로드 게이트·저장 큐를 그대로 태운다.

   v3.1.0 동작:
   - 메모 모드(기본): Ctrl+Enter 등록, Esc/blur = 숨김만 (내용은 절대 안 지움 —
     지우는 건 사용자 몫). 입력할 때마다 초안을 메인 창으로 흘려보내
     settings.captureDraft로 저장 → 앱이 꺼져도 다음 실행 때 분류 대기로 자동 등록.
   - Alt: 검색 모드 토글 (Spotlight식). 왼쪽=내 업무(quick_search), 오른쪽=파일
     (everything_search; 설정 '빠른 검색 시 Everything 사용'이 꺼져 있으면 생략).
     업무 클릭 → 메인 창에서 열기, 파일 클릭 → 바로 열기. 메모 초안은 별도
     입력칸이라 검색해도 그대로 남는다.
   ========================================================================= */
let submitting=false;                       // 등록 플래시 중 blur로 조기 숨김 방지
let mode='memo';                            // 'memo' | 'search'
let draftTimer=null, searchTimer=null, searchSeq=0;
let evPort=null, evDownUntil=0;
const EV_PORTS=[80,8080];

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
  invoke('resize_capture',{height:search?430:150}).catch(()=>{});   // 메모 모드 = 2배 높이(그림자 여백 포함 150)
  const t=search?$id('cap-search'):$id('cap-inp');
  t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  if(search) runSearch($id('cap-search').value.trim());
}

async function evSearch(q){
  if(Date.now()<evDownUntil) return [];
  let settings={};
  try{ settings=await invoke('load_settings_only')||{}; }catch{}
  if(settings.everythingQuickSearch===false) return [];
  const ports=Number(settings.everythingPort)?[Number(settings.everythingPort)]:(evPort?[evPort]:EV_PORTS);
  for(const p of ports){
    try{
      const body=await invoke('everything_search',{query:q,port:p,count:12});
      evPort=p;
      const d=JSON.parse(body);
      return Array.isArray(d.results)?d.results:[];
    }catch{ /* 다음 포트 */ }
  }
  evDownUntil=Date.now()+120e3; evPort=null;
  return [];
}

async function runSearch(q){
  const seq=++searchSeq;
  const iw=$id('cap-items'), fw=$id('cap-files');
  if(!q){ iw.innerHTML='<div class="cap-empty">검색어를 입력하세요</div>'; fw.innerHTML=''; return; }
  const [items,files]=await Promise.all([
    invoke('quick_search',{query:q}).catch(()=>[]),
    evSearch(q),
  ]);
  if(seq!==searchSeq) return;               // 그 사이 새 검색어 입력됨
  iw.innerHTML=items.length?items.map(h=>
    `<div class="cap-hit${h.done?' done':''}" data-item="${h.id}">${h.done?'[완료] ':''}${esc(h.memo||'(메모 없음)')}</div>`
  ).join(''):'<div class="cap-empty">일치하는 업무 없음</div>';
  fw.innerHTML=files.length?files.map(r=>{
    const full=(r.path?r.path+'\\':'')+(r.name||'');
    return `<div class="cap-hit" data-file="${esc(full)}" title="${esc(full)}">${esc(r.name||'')}</div>`;
  }).join(''):'<div class="cap-empty">파일 결과 없음 (Everything 미실행이면 표시되지 않습니다)</div>';
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

  /* 검색 결과 클릭 — 업무는 메인 창에서 열고, 파일은 바로 연다 */
  $id('cap-results').addEventListener('click',e=>{
    const ih=e.target.closest('[data-item]');
    if(ih){
      window.__TAURI__.event.emitTo('main','wmhh://open-item',{id:Number(ih.dataset.item)}).catch(()=>{});
      invoke('focus_main_window').catch(()=>{});
      hideWin(); return;
    }
    const fh=e.target.closest('[data-file]');
    if(fh){ invoke('open_file_path',{path:fh.dataset.file}).catch(()=>{}); }
  });

  /* 포커스를 잃으면 숨김 — 초안은 유지 + 저장 플러시 */
  window.addEventListener('blur',()=>{ if(!submitting){ sendDraft(inp.value); hideWin(); } });
  window.addEventListener('focus',()=>{
    const t=mode==='search'?searchInp:inp;
    t.focus(); const n=t.value.length; try{t.setSelectionRange(n,n);}catch{}
  });
  inp.focus();
}
