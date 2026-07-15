/* =========================================================================
   주기 업무(부모 정의) 입력·관리 UI + 생성 트리거.
   부모 = it.recur 있는 아이템(보드 밖, 공통정보 최소). 자식 = recurId로 부모를
   가리키는 일반 아이템(보드에 자동 생성). 여기서는 부모의 등록/수정/일시정지/삭제와,
   예정일 도래분 생성(runRecurSpawn)을 담당한다.
   ========================================================================= */
import {S, makeItem} from './state.js';
import {$, esc, escAttr, showToast} from './dom-utils.js';
import {fmtT, parseTimeStr} from './datetime.js';
import {isValidRecur, recurLabel, initialNext, spawnDueOccurrences, DOW_KO} from './recur.js';
import {persist, render} from './render.js';

let editingParentId=null;   // 수정 중인 부모 id (없으면 신규)

/* 예정일이 도래한 자식 생성 → S.items에 반영 + 저장/렌더. main.js가 로드 직후와
   주기적으로 호출한다. 중복 생성은 부모 recur.next 전진으로 막는다(persist가 저장). */
export function runRecurSpawn(){
  const spawned=spawnDueOccurrences(S.items, new Date());
  if(spawned.length){ S.items.push(...spawned); persist(); }
  return spawned.length;
}

const parents = () => S.items.filter(it=>isValidRecur(it.recur));
const childCount = (pid) => S.items.filter(it=>it.recurId===pid).length;

function renderDow(selected){
  $('rc-dow').innerHTML=DOW_KO.map((n,d)=>
    `<button type="button" class="recur-dow-btn${(selected||[]).includes(d)?' on':''}" data-dow="${d}">${n}</button>`).join('');
}
function refreshTypeVis(){
  const t=$('rc-type').value;
  $('rc-dow').style.display = t==='dow'?'inline-flex':'none';
  $('rc-monthly').style.display = t==='monthly'?'inline':'none';
}
/* 시각 입력 정규화 — HH:MM 뿐 아니라 HHMM·HMM·HH(콜론 없이)도 허용해 'HH:MM'으로.
   앱 공용 파서(parseTimeStr) 재사용. 파싱 실패 시 원본 반환(isValidRecur에서 걸림). */
function normTime(raw){
  const p=parseTimeStr(raw);
  if(!p) return raw;
  const hh=p.dayOverflow?0:p.hh;
  return String(hh).padStart(2,'0')+':'+String(p.mm).padStart(2,'0');
}
function collectRecur(){
  const type=$('rc-type').value;
  const time=normTime($('rc-time').value.trim()||'09:00');
  if(type==='monthly') return {type:'monthly', day:Number($('rc-mday').value)||1, time};
  const dow=[...$('rc-dow').querySelectorAll('.recur-dow-btn.on')].map(b=>+b.dataset.dow);
  return {type:'dow', dow, time};
}
/* 스케줄(주기)만 비교 — next/paused 등 부가 상태는 제외 */
function sameSchedule(a,b){
  if(!a||!b||a.type!==b.type||a.time!==b.time) return false;
  if(a.type==='dow') return JSON.stringify([...(a.dow||[])].sort((x,y)=>x-y))===JSON.stringify([...(b.dow||[])].sort((x,y)=>x-y));
  if(a.type==='monthly') return Number(a.day)===Number(b.day);
  return Number(a.days)===Number(b.days);   // (구 데이터) every — 신규 입력에선 안 나옴
}

function resetInput(){
  editingParentId=null;
  $('rc-new-head').textContent='＋ 새 주기 업무';
  $('rc-memo').value='';
  $('rc-type').value='dow';
  renderDow([]);
  $('rc-mday').value=1;
  $('rc-time').value='09:00';
  $('rc-save').textContent='등록';
  $('rc-cancel-edit').style.display='none';
  refreshTypeVis();
}
function fillForEdit(p){
  editingParentId=p.id;
  $('rc-new-head').textContent='주기 업무 수정';
  $('rc-memo').value=p.memo||'';
  const r=p.recur||{};
  // '며칠마다'(every)는 v2.4.4에서 제거 — 옛 every 부모를 열면 요일 반복으로 표시(저장 시 전환)
  $('rc-type').value=(r.type==='monthly')?'monthly':'dow';
  renderDow(r.type==='dow'?r.dow:[]);
  $('rc-mday').value=r.type==='monthly'?(r.day||1):1;
  $('rc-time').value=r.time||'09:00';
  $('rc-save').textContent='수정 저장';
  $('rc-cancel-edit').style.display='';
  refreshTypeVis();
}

function renderList(){
  const list=parents();
  $('rc-list').innerHTML = list.length ? list.map(p=>{
    const next = p.recur.paused ? '일시정지' : (fmtT(p.recur.next)||'예정 계산 중');
    const n=childCount(p.id);
    return `<div class="rc-row${p.recur.paused?' paused':''}" data-pid="${p.id}">
      <div class="rc-main">
        <div class="rc-memo">${esc(p.memo||'(제목 없음)')}</div>
        <div class="rc-meta">${esc(recurLabel(p.recur))} · 다음: ${esc(next)} · 생성 ${n}건</div>
      </div>
      <div class="rc-acts">
        <button class="btn btn-tool" data-rc-edit="${p.id}">수정</button>
        <button class="btn btn-tool" data-rc-pause="${p.id}">${p.recur.paused?'재개':'정지'}</button>
        <button class="btn btn-tool rc-del" data-rc-del="${p.id}">삭제</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">등록된 주기 업무가 없습니다. 위에서 공통 내용과 반복 주기를 등록하세요.</div>';
}

export function openRecurModal(){ resetInput(); renderList(); $('recurModal').classList.add('on'); $('rc-memo').focus(); }
function closeRecurModal(){ $('recurModal').classList.remove('on'); }

function saveParent(){
  const memo=$('rc-memo').value.trim();
  if(!memo){ alert('공통 내용(제목/메모)을 입력하세요.'); $('rc-memo').focus(); return; }
  const recur=collectRecur();
  if(!isValidRecur(recur)){
    alert('반복 주기가 올바르지 않습니다.\n(요일을 하나 이상 선택하거나 매월 날짜를 1~31로, 시각은 09:00 형식으로)');
    return;
  }
  if(editingParentId){
    const p=S.items.find(x=>x.id===editingParentId);
    if(p){
      p.memo=memo;
      const keepNext = sameSchedule(p.recur, recur) ? p.recur.next : initialNext(recur, new Date());
      p.recur=Object.assign({}, recur, {next:keepNext, paused:!!p.recur.paused});
    }
  }else{
    const parent=makeItem({memo, staged:false, recur:Object.assign({}, recur, {next:initialNext(recur, new Date()), paused:false})});
    S.items.push(parent);
  }
  resetInput();
  runRecurSpawn();     // 첫 회차가 오늘이면 즉시 생성 (+persist)
  persist();           // 부모 등록/수정 저장
  render();
  renderList();
  showToast(editingParentId?'주기 업무를 수정했습니다':'주기 업무를 등록했습니다');
}

export function initRecurBox(){
  document.body.appendChild($('recurModal'));   // 어느 탭에서든 뜨도록 body 직속
  $('recurManageBtn').addEventListener('click', openRecurModal);   // [설정] 메뉴에서 진입
  $('recurClose').addEventListener('click', closeRecurModal);
  $('recurModal').addEventListener('click',e=>{ if(e.target.id==='recurModal') closeRecurModal(); });
  $('rc-type').addEventListener('change', refreshTypeVis);
  $('rc-dow').addEventListener('click',e=>{ const b=e.target.closest('.recur-dow-btn'); if(b) b.classList.toggle('on'); });
  $('rc-time').addEventListener('blur',e=>{ const n=normTime(e.target.value.trim()); if(n) e.target.value=n; });   // 0930 → 09:30 즉시 반영
  $('rc-save').addEventListener('click', saveParent);
  $('rc-cancel-edit').addEventListener('click', resetInput);
  $('rc-list').addEventListener('click',e=>{
    const ed=e.target.closest('[data-rc-edit]');
    if(ed){ const p=S.items.find(x=>x.id==ed.dataset.rcEdit); if(p) fillForEdit(p); return; }
    const pa=e.target.closest('[data-rc-pause]');
    if(pa){ const p=S.items.find(x=>x.id==pa.dataset.rcPause);
      if(p){ p.recur.paused=!p.recur.paused; if(!p.recur.paused && !p.recur.next) p.recur.next=initialNext(p.recur,new Date());
        runRecurSpawn(); persist(); render(); renderList(); } return; }
    const de=e.target.closest('[data-rc-del]');
    if(de){ const id=+de.dataset.rcDel; const idx=S.items.findIndex(x=>x.id===id);
      if(idx>=0){ const n=childCount(id);
        if(!confirm(`이 주기 업무를 삭제할까요?\n이미 생성된 업무 ${n}건은 그대로 남습니다.`)) return;
        const removed=S.items[idx]; S.items.splice(idx,1); persist(); render(); renderList();
        showToast('주기 업무를 삭제했습니다',()=>{ S.items.splice(Math.min(idx,S.items.length),0,removed); persist(); render(); renderList(); });
      } return; }
  });
}
