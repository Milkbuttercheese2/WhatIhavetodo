/* =========================================================================
   정기함 — 반복 일정 정의(recurDef) 관리. 고급 탭(⚙ 설정 → 고급)의 '정기함 사용'
   옵트인 토글 뒤에 산다(기본 꺼짐). 목록은 탭 안에 인라인, 추가/수정만 별도 모달.
   반복은 보드 밖 생성기(state.js reconcileRecur)가 도래 시점에 보드로 스폰한다.
   집 규칙: 호이스팅 function + 모듈 지역 let 만. 리스너는 전부 initRecurBox().
   ========================================================================= */
import {S, newId, reconcileRecur} from './state.js';
import {STORE} from './store.js';
import {$, esc} from './dom-utils.js';
import {dtInner, refreshDow, readDtInput} from './datetime.js';
import {persist} from './render.js';

const DOW_LABELS=['일','월','화','수','목','금','토'];
const pad2 = n => String(n).padStart(2,'0');
let editingId=null;

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }
function saveDefs(){ window.RECUR_DEFS=S.recurDefs; STORE.saveRecurDefs(S.recurDefs); }
/* 정의 저장 후: 도래한 회차가 있으면 스폰하고 보드를 다시 그린다 */
function applyAndRender(){ saveDefs(); if(reconcileRecur()) persist(); }

function freqSummary(def){
  const t = `${pad2(def.time?.hh??0)}:${pad2(def.time?.mm??0)}`;
  if(def.freq==='daily')   return `매일 ${t}`;
  if(def.freq==='monthly'){ const day=def.next?new Date(def.next).getDate():'?'; return `매월 ${day}일 ${t}`; }
  const dow=(def.dow&&def.dow.length)?def.dow.slice().sort((a,b)=>a-b).map(d=>DOW_LABELS[d]).join('·'):'(시작일 요일)';
  return `매주 ${dow} ${t}`;
}
function formatNext(iso){
  const d=iso?new Date(iso):null; if(!d||isNaN(d)) return '—';
  return `${d.getMonth()+1}/${d.getDate()}(${DOW_LABELS[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/* dt 위젯은 로컬 날짜/시각 문자열을 받는다 */
function isoDate(iso){ const d=new Date(iso); if(isNaN(d))return''; return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`; }
function isoTime(iso){ const d=new Date(iso); if(isNaN(d))return''; return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function renderRecurList(){
  const w=$('recurList'); if(!w) return;
  if(!S.recurDefs.length){ w.innerHTML='<div class="empty">등록된 정기 일정이 없습니다. 아래에서 추가하세요.</div>'; return; }
  w.innerHTML=S.recurDefs.map((d,i)=>`<div class="rc-item${d.paused?' paused':''}" data-rid="${d.id}"><div class="rc-body">
    <div class="rc-memo">${esc(d.memo||'(메모 없음)')}${d.paused?' <span class="rc-paused-tag">일시정지</span>':''}</div>
    <div class="rc-meta">${esc(freqSummary(d))} · 다음: ${esc(formatNext(d.next))}</div>
    </div>
    <button class="rc-toggle" data-rtoggle="${i}">${d.paused?'재개':'일시정지'}</button>
    <button class="ps-edit" data-redit="${i}">수정</button>
    <button class="ps-del" data-rdel="${i}">삭제</button></div>`).join('');
}

/* 고급 탭 패널 동기화 — 토글 상태 + 본문 표시/숨김 + 목록. settings.openSettings와
   initRecurBox가 호출한다. */
export function renderRecurPanel(){
  const cb=$('set-recur-enabled'); if(!cb) return;
  const on=!!(S.settings && S.settings.recurEnabled);
  cb.checked=on;
  const body=$('recurBody'); if(body) body.style.display=on?'block':'none';
  if(on) renderRecurList();
}

/* ---- 추가/수정 모달 ---- */
function renderDow(sel){
  const set=new Set(Array.isArray(sel)?sel:[]);
  $('rc-dow').innerHTML=DOW_LABELS.map((lb,i)=>
    `<label class="dow-chip"><input type="checkbox" value="${i}"${set.has(i)?' checked':''}>${lb}</label>`).join('');
}
function readDow(){ return [...$('rc-dow').querySelectorAll('input:checked')].map(c=>Number(c.value)).sort((a,b)=>a-b); }
function syncDowVis(){ $('rc-dow-wrap').style.display = $('rc-freq').value==='weekly' ? 'block' : 'none'; }
function buildDt(iso){ const dt=$('rc-dt'); dt.className='dt-inp'; dt.innerHTML=dtInner(iso?isoDate(iso):'', iso?isoTime(iso):''); refreshDow(dt); }

function openAdd(){
  editingId=null;
  $('rc-memo').value=''; $('rc-freq').value='weekly'; renderDow([]); syncDowVis(); buildDt('');
  $('rc-new-head').textContent='＋ 새 정기 등록'; $('rc-save').textContent='저장';
  $('recurModal').classList.add('on'); $('rc-memo').focus();
}
function openEdit(idx){
  const d=S.recurDefs[idx]; if(!d)return;
  editingId=d.id;
  $('rc-memo').value=d.memo||''; $('rc-freq').value=d.freq||'weekly'; renderDow(d.dow); syncDowVis(); buildDt(d.next);
  $('rc-new-head').textContent='✎ 정기 일정 수정'; $('rc-save').textContent='수정 저장';
  $('recurModal').classList.add('on'); $('rc-memo').focus();
}
export function closeRecurModal(){ $('recurModal').classList.remove('on'); }

function saveFromForm(){
  const memo=$('rc-memo').value.trim();
  if(!memo){ alert('메모(보드에 올라올 내용)를 입력하세요.'); $('rc-memo').focus(); return; }
  const first=readDtInput($('rc-dt'));
  if(first===null){ alert('시작 날짜·시각이 올바르지 않습니다.\n(예: 2026/07/13 · 09:00)'); return; }
  if(first===''){ alert('처음 시작 날짜를 입력하세요.'); return; }
  const freq=$('rc-freq').value;
  const d=new Date(first);
  const def={ id: editingId||newId(), memo, freq,
    dow: freq==='weekly'?readDow():[],
    time:{hh:d.getHours(), mm:d.getMinutes()},
    next:first,
    paused: editingId ? (S.recurDefs.find(x=>x.id===editingId)?.paused||false) : false };
  if(editingId){ const i=S.recurDefs.findIndex(x=>x.id===editingId); if(i>=0)S.recurDefs[i]=def; }
  else S.recurDefs.push(def);
  closeRecurModal(); applyAndRender(); renderRecurList();
}

export function initRecurBox(){
  const cb=$('set-recur-enabled');
  if(cb) cb.addEventListener('change',()=>{
    S.settings.recurEnabled=cb.checked; saveSettings(); renderRecurPanel();
    if(cb.checked && reconcileRecur()) persist();
  });
  const add=$('rc-add'); if(add) add.addEventListener('click', openAdd);
  const rc=$('rc-cancel'); if(rc) rc.addEventListener('click', closeRecurModal);
  const rf=$('rc-freq'); if(rf) rf.addEventListener('change', syncDowVis);
  const rs=$('rc-save'); if(rs) rs.addEventListener('click', saveFromForm);
  const list=$('recurList');
  if(list) list.addEventListener('click', e=>{
    const tg=e.target.closest('[data-rtoggle]');
    if(tg){ const d=S.recurDefs[+tg.dataset.rtoggle]; if(d){ d.paused=!d.paused; applyAndRender(); renderRecurList(); } return; }
    const ed=e.target.closest('[data-redit]'); if(ed){ openEdit(+ed.dataset.redit); return; }
    const del=e.target.closest('[data-rdel]'); if(!del)return;
    const d=S.recurDefs[+del.dataset.rdel];
    if(confirm(`정기 일정 "${d.memo||'(메모 없음)'}"을(를) 삭제할까요?\n(이미 보드에 올라온 회차는 그대로 남습니다.)`)){
      S.recurDefs.splice(+del.dataset.rdel,1); saveDefs(); renderRecurList(); if(editingId===d.id) closeRecurModal();
    }
  });
  /* 도래 회차 폴링(60초) — 옵트인이 꺼져 있으면 reconcileRecur가 즉시 반환한다 */
  setInterval(()=>{ if(reconcileRecur()) persist(); }, 60000);
  renderRecurPanel();
}
