/* =========================================================================
   DOM 유틸 — 요소 조회 · 이스케이프 · 토스트 · 드래그 재정렬 · 알림 권한
   ========================================================================= */
export const $ = id => document.getElementById(id);

/* F8: 숫자 등 비문자열이 들어와도 죽지 않도록 문자열화 */
export function esc(s){return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
/* F11: '&'를 먼저 이스케이프해야 편집 왕복 시 &amp; 가 &로 붕괴하지 않음 */
export function escAttr(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

/* 드래그로 순서 바꾸기 — 핸들(.drag-handle)을 잡아야만 드래그 시작.
   컨테이너 안의 rowSelector 요소들을 재정렬. onDrop(container) 콜백으로 저장 처리. */
export function enableDragReorder(container, rowSelector, handleSelector, onDrop){
  let dragEl=null;
  const clearDraggable=()=>container.querySelectorAll('[draggable="true"]').forEach(r=>r.removeAttribute('draggable'));
  container.addEventListener('mousedown',e=>{
    const h=e.target.closest(handleSelector);
    const row=e.target.closest(rowSelector);
    if(h&&row&&container.contains(row)) row.setAttribute('draggable','true');
  });
  // 컨테이너 밖에서 놓아도 draggable 이 남지 않도록 문서 전역에서 해제
  document.addEventListener('mouseup',()=>{ if(!dragEl) clearDraggable(); });
  container.addEventListener('dragstart',e=>{
    const row=e.target.closest(rowSelector);
    if(!row||row.getAttribute('draggable')!=='true'){ e.preventDefault(); return; }
    dragEl=row; row.classList.add('dragging');
    try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',''); }catch{}
  });
  container.addEventListener('dragover',e=>{
    if(!dragEl)return; e.preventDefault();
    const after=[...container.querySelectorAll(rowSelector+':not(.dragging)')].reduce((closest,child)=>{
      const box=child.getBoundingClientRect(); const offset=e.clientY-box.top-box.height/2;
      if(offset<0&&offset>closest.offset) return {offset,el:child}; return closest;
    },{offset:-Infinity,el:null}).el;
    if(after==null) container.appendChild(dragEl); else container.insertBefore(dragEl,after);
  });
  container.addEventListener('drop',e=>{ e.preventDefault(); });
  container.addEventListener('dragend',()=>{
    if(dragEl){ dragEl.classList.remove('dragging'); }
    dragEl=null; clearDraggable(); if(onDrop) onDrop(container);
  });
}

/* 실행취소 토스트 */
let _toastTimer=null,_undoFn=null;
export function showToast(msg,undoFn){ $('toast-msg').textContent=msg; _undoFn=undoFn||null; $('toast-undo').style.display=undoFn?'inline-block':'none';
  $('toast').classList.add('on'); clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>{$('toast').classList.remove('on');_undoFn=null;},6000); }
export function initToast(){
  $('toast-undo').addEventListener('click',()=>{ if(_undoFn){const fn=_undoFn;_undoFn=null;$('toast').classList.remove('on');clearTimeout(_toastTimer);fn();} });
}

/* 알림 권한 요청 (최초 1회) — persist()가 부르므로 알람 모듈이 아닌 여기에 둔다 */
let notifyAsked=false;
export function askNotify(){ if(notifyAsked||!('Notification'in window))return; notifyAsked=true; if(Notification.permission==='default'){try{Notification.requestPermission();}catch{}} }
