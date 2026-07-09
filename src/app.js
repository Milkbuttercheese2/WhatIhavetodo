/* =========================================================================
   저장 계층 — Rust(SQLite) 백엔드에 Tauri invoke()로 위임.
   실제 값은 모두 SQLite가 단일 진실 공급원이며, 브라우저 저장소(localStorage/
   IndexedDB)는 더 이상 쓰지 않는다.
   ========================================================================= */
/* F1: 초기 로드 완료 게이트. 로드 전 저장을 막아 기존 데이터 소실을 방지 */
let LOADED = false;
const { invoke } = window.__TAURI__.core;

const STORE = {
  _saving:null, _pending:null,

  /* fields/presets/idKinds/settings는 window.__imported* 로 비동기 전달되고,
     각 모듈 초기화 코드가 이미 그 값을 반영하는 reconcileImported()를 호출한다
     (기존 IndexedDB 버전도 동일한 패턴이었다 — loadFields() 등은 동기 기본값,
     STORE.load() 완료 후 진짜 값으로 교체). */
  async load(){
    const state = await invoke('load_all');
    if(Array.isArray(state.fields)) window.__importedFields=state.fields;
    if(Array.isArray(state.presets)) window.__importedPresets=state.presets;
    if(Array.isArray(state.idKinds)) window.__importedIdKinds=state.idKinds;
    if(state.settings && typeof state.settings==='object') window.__importedSettings=state.settings;
    return Array.isArray(state.items)?state.items:[];
  },

  async saveAll(items){
    if(!LOADED) return;                       // F1: 초기 로드 완료 전 저장 차단 (기존 데이터 소실 방지)
    this._pending=items;
    if(this._saving) return;
    this._saving=(async()=>{
      try{
        while(this._pending){
          const data=this._pending; this._pending=null;
          await invoke('save_all', {items:data});
          setStatus('saved');
        }
      }catch(e){ console.warn('저장 실패',e); setStatus('error'); }
      finally{ this._saving=null; }
    })();
  },

  loadFields(){ return null; },
  saveFields(f){ if(!LOADED)return; invoke('save_fields', {fields:f}).catch(e=>console.warn('필드 저장 실패',e)); },
  loadPresets(){ return null; },
  savePresets(p){ if(!LOADED)return; invoke('save_presets', {presets:p}).catch(e=>console.warn('프리셋 저장 실패',e)); },
  loadIdKinds(){ return null; },
  saveIdKinds(k){ if(!LOADED)return; invoke('save_id_kinds', {idKinds:k}).catch(e=>console.warn('식별번호 명칭 저장 실패',e)); },
  loadSettings(){ return null; },
  saveSettings(s){ if(!LOADED)return; invoke('save_settings', {settings:s}).catch(e=>console.warn('설정 저장 실패',e)); }
};
function setStatus(kind){
  const el=document.getElementById('saveStatus'); if(!el)return;
  if(kind==='error'){
    el.style.display='';
    el.className='save-local'; el.textContent='⚠ 저장 실패';
    el.title='자동 저장에 실패했습니다. [JSON파일 백업]으로 파일을 남겨두세요.';
  }else{
    // 평소엔 표시 안 함 — 저장은 항상 자동으로 되고, 실패했을 때만 알리면 된다.
    el.style.display='none';
  }
}

/* =========================================================================
   필드 정의 — 중간점검시각은 세부할일 전용이므로 상위 필드에서 제거.
   상위 시각 필드는 접수·마감만.
   ========================================================================= */
const CORE_FIELDS = [
  {key:'received', label:'접수시각', type:'datetime', on:true, builtin:true},
  {key:'due',      label:'마감시각', type:'datetime', on:true, builtin:true},
];
const DEFAULT_ID_KINDS = ['입찰공고번호','계약체결번호','공사관리번호','SR번호','국민신문고번호'];
let ID_KINDS = STORE.loadIdKinds() || DEFAULT_ID_KINDS.slice();
window.ID_KINDS = ID_KINDS;
function saveIdKinds(){ window.ID_KINDS=ID_KINDS; STORE.saveIdKinds(ID_KINDS); }

/* 설정 (알람 on/off 등) */
const DEFAULT_SETTINGS={ alarmOn:true };
let SETTINGS = Object.assign({}, DEFAULT_SETTINGS, STORE.loadSettings()||{});
window.SETTINGS = SETTINGS;
function saveSettings(){ window.SETTINGS=SETTINGS; STORE.saveSettings(SETTINGS); }

let FIELDS = STORE.loadFields() || JSON.parse(JSON.stringify(CORE_FIELDS));
window.FIELDS = FIELDS;
(function reconcileCore(){
  const custom = FIELDS.filter(f=>!CORE_FIELDS.some(cf=>cf.key===f.key) && !['who','org','phone','mid','notice','sr'].includes(f.key));
  const merged = CORE_FIELDS.map(cf=>{ const ex=FIELDS.find(x=>x.key===cf.key); return ex?Object.assign({},cf,{on:true,builtin:true}):JSON.parse(JSON.stringify(cf)); });
  FIELDS = merged.concat(custom); window.FIELDS=FIELDS;
})();

let items = [];
window.items = items;
const $ = id => document.getElementById(id);

/* F12: 단조 증가 ID — 같은 ms 내 충돌 방지 */
let _lastId = 0;
function newId(){
  const t = Date.now();
  _lastId = (t > _lastId) ? t : _lastId + 1;
  return _lastId;
}

/* 드래그로 순서 바꾸기 — 핸들(.drag-handle)을 잡아야만 드래그 시작.
   컨테이너 안의 rowSelector 요소들을 재정렬. onDrop(container) 콜백으로 저장 처리. */
function enableDragReorder(container, rowSelector, handleSelector, onDrop){
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
const enabled = () => FIELDS.filter(f=>f.on);

/* =========================================================================
   날짜/시간 유틸 — 분리 입력 파서
   날짜: YYYY/MM/DD, YYYY-MM-DD, YYYYMMDD, YYYY.MM.DD 등
   시간: HH:MM, HHMM, HH (분 생략 시 00), 0~24시, 분 자유(0~59)
   ========================================================================= */
/* F4: 존재하지 않는 날짜(2/31 등) 거부 — 생성 후 왕복 검증 */
function validDate(y,m,da){
  if(!(m>=1&&m<=12&&da>=1&&da<=31)) return false;
  const t=new Date(y,m-1,da);
  return t.getFullYear()===y && t.getMonth()===m-1 && t.getDate()===da;
}
function parseDateStr(s){
  if(!s) return null;
  const d=String(s).replace(/[^0-9]/g,'');
  if(d.length===8){ const y=+d.slice(0,4),m=+d.slice(4,6),da=+d.slice(6,8);
    if(validDate(y,m,da)) return {y,m,d:da}; }
  if(d.length===6){ const y=2000+ +d.slice(0,2),m=+d.slice(2,4),da=+d.slice(4,6);
    if(validDate(y,m,da)) return {y,m,d:da}; }
  return null;
}
function parseTimeStr(s){
  if(s===''||s==null) return null;
  const t=s.replace(/[^0-9]/g,'');
  let hh,mm;
  if(t.length<=2){ hh=+t; mm=0; }
  else if(t.length===3){ hh=+t.slice(0,1); mm=+t.slice(1); }
  else { hh=+t.slice(0,2); mm=+t.slice(2,4); }
  if(isNaN(hh)||isNaN(mm)) return null;
  if(hh>24||hh<0||mm>59||mm<0) return null;
  const dayOverflow = hh===24;       // 24시(끝자정) 입력 = 다음날 그 분(分). 날짜 이월은 combineDT가 처리
  if(dayOverflow){ hh=0; }
  return {hh,mm,dayOverflow};
}
/* 시각 미입력 시 기본값 */
const DEFAULT_TIME_DUE  = {hh:18, mm:0};   // 마감·중간점검
const DEFAULT_TIME_ZERO = {hh:0,  mm:0};   // 접수시각 등

/* F3: 반환 3종 —  '' = 미입력(정상),  null = 오입력(저장 차단),  ISO = 정상 */
function combineDT(dateStr,timeStr,def){
  const ds=String(dateStr??'').trim(), ts=String(timeStr??'').trim();
  if(ds==='') return ts==='' ? '' : null;      // 시각만 입력 → 오입력
  const dp=parseDateStr(ds);
  if(!dp) return null;                          // 날짜 오입력
  let tp;
  if(ts==='') tp = def || DEFAULT_TIME_ZERO;    // 시각 미입력 → 기본값
  else { tp=parseTimeStr(ts); if(!tp) return null; }   // 시각 오입력 → 삼키지 않음
  const d=new Date(dp.y, dp.m-1, dp.d, tp.hh, tp.mm, 0, 0);
  if(tp.dayOverflow) d.setDate(d.getDate()+1);   // F13: "24:00" 입력 시 다음날로 이월 (안 하면 시각이 24시간 어긋남)
  if(isNaN(d)) return null;
  return d.toISOString();
}
function isoToDateStr(iso){ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; }
function isoToTimeStr(iso){ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
/* 세부 점검시각 기본값: 오늘 18:00 */

/* 분리 날짜/시간 입력 위젯 HTML */
/* 날짜/시간 입력 내부 마크업 (텍스트 직접입력 + 캘린더 선택 + 요일 표시) */
function dtInner(dateStr,timeStr){
  return `<input type="text" class="dt-date" placeholder="YYYY/MM/DD" maxlength="10" value="${escAttr(dateStr)}">
    <button type="button" class="dt-pick" title="캘린더에서 선택">📅</button>
    <input type="date" class="dt-native" tabindex="-1" aria-hidden="true">
    <span class="dt-dow"></span>
    <input type="text" class="dt-time" placeholder="HH:MM" maxlength="5" title="비워두면 기본 시각이 채워집니다 (마감·점검 18:00)" value="${escAttr(timeStr)}">`;
}
function dtInputHtml(cls, iso, dataAttr){
  return `<span class="dt-inp ${cls}" ${dataAttr}>${dtInner(isoToDateStr(iso), isoToTimeStr(iso))}</span>`;
}
/* 요일 갱신 */
function refreshDow(span){
  const dw=span.querySelector('.dt-dow'); if(!dw)return;
  const dp=parseDateStr(span.querySelector('.dt-date').value);
  dw.textContent = dp ? `(${DOW[new Date(dp.y,dp.m-1,dp.d).getDay()]})` : '';
}
/* 캘린더 버튼/네이티브 date 입력 연동 (이벤트 위임, 문서 전체) */
document.addEventListener('click',e=>{
  const btn=e.target.closest('.dt-pick'); if(!btn)return;
  e.preventDefault(); e.stopPropagation();
  const span=btn.closest('.dt-inp'); const nat=span.querySelector('.dt-native');
  const dp=parseDateStr(span.querySelector('.dt-date').value);
  if(dp) nat.value=`${dp.y}-${String(dp.m).padStart(2,'0')}-${String(dp.d).padStart(2,'0')}`;
  try{ nat.showPicker ? nat.showPicker() : nat.click(); }catch{ nat.click(); }
});
document.addEventListener('change',e=>{
  const nat=e.target.closest('.dt-native'); if(!nat)return;
  const span=nat.closest('.dt-inp'); if(!nat.value)return;
  const [y,m,d]=nat.value.split('-');
  span.querySelector('.dt-date').value=`${y}/${m}/${d}`;
  const te=span.querySelector('.dt-time');
  if(te && te.value.trim()===''){                       // 캘린더로 날짜만 고른 경우 기본 시각 채움
    const def = span.dataset.fkey==='received' ? DEFAULT_TIME_ZERO : DEFAULT_TIME_DUE;
    te.value = `${String(def.hh).padStart(2,'0')}:${String(def.mm).padStart(2,'0')}`;
  }
  refreshDow(span);
  markDtValidity(span);
  span.dispatchEvent(new Event('input',{bubbles:true}));
});
document.addEventListener('input',e=>{
  const de=e.target.closest('.dt-date'); if(!de)return;
  refreshDow(de.closest('.dt-inp'));
});
function readDtInput(spanEl){
  const dd=spanEl.querySelector('.dt-date').value;
  const tt=spanEl.querySelector('.dt-time').value;
  // 접수시각은 00:00, 그 외(마감·중간점검)는 18:00을 기본값으로
  const isReceived = spanEl.dataset.fkey==='received';
  return combineDT(dd,tt, isReceived?DEFAULT_TIME_ZERO:DEFAULT_TIME_DUE);
}
/* 오입력 칸에 빨간 테두리. 포커스 중에는 판정 유예(타이핑 중 오탐 방지) */
function markDtValidity(span){
  if(!span) return true;
  if(span.contains(document.activeElement)) return true;
  const bad = readDtInput(span)===null;
  span.classList.toggle('dt-bad', bad);
  return !bad;
}
function validateAllDt(root){
  let ok=true;
  root.querySelectorAll('.dt-inp').forEach(sp=>{ if(!markDtValidity(sp)) ok=false; });
  return ok;
}
/* 포커스가 빠질 때 재판정 + 시각 비어있으면 기본값 자동 채움 */
document.addEventListener('focusout',e=>{
  const sp=e.target.closest && e.target.closest('.dt-inp');
  if(!sp) return;
  setTimeout(()=>{
    if(sp.contains(document.activeElement)) return;   // 아직 이 위젯 안에 있으면 대기
    const de=sp.querySelector('.dt-date'), te=sp.querySelector('.dt-time');
    // 날짜가 유효한데 시각이 비어 있으면 기본 시각을 눈에 보이게 채움
    if(te && te.value.trim()==='' && parseDateStr(de.value)){
      const def = sp.dataset.fkey==='received' ? DEFAULT_TIME_ZERO : DEFAULT_TIME_DUE;
      te.value = `${String(def.hh).padStart(2,'0')}:${String(def.mm).padStart(2,'0')}`;
    }
    markDtValidity(sp);
  },0);
});

/* =========================================================================
   자동 배치 규칙
   ========================================================================= */
function dayBounds(){ const t0=new Date();t0.setHours(0,0,0,0);const t1=new Date(t0);t1.setDate(t1.getDate()+1);return [t0,t1]; }
/* 미완료 세부 점검시각들 (지난 것 포함) */
function subMids(it){ return (it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid)).filter(d=>!isNaN(d)); }
function placeOf(it){
  if(it.done) return 'done';
  if(it.staged) return 'inbox';
  const f=it.f||{}, now=new Date(), [t0,t1]=dayBounds();
  const due=f.due?new Date(f.due):null;
  const vd=due&&!isNaN(due);
  const mids=subMids(it).sort((a,b)=>a-b);
  const overdueMid = mids.find(d=>d<now) || null;        // 이미 지난 미완료 점검
  const futureMids = mids.filter(d=>d>=now);
  const nextMid = futureMids[0] || null;                  // 앞으로 도래할 가장 가까운 점검

  // 오늘 처리: 마감이 지났거나 오늘 / 점검이 지났거나 오늘
  if(vd&&due<now) return 'today';
  if(vd&&due>=t0&&due<t1) return 'today';
  if(overdueMid) return 'today';
  if(nextMid&&nextMid>=t0&&nextMid<t1) return 'today';

  const subs=it.subs||[];
  // '진행 중' = 실제로 손을 댄 업무
  const started = subs.length>0 && subs.some(s=>s.done) && subs.some(s=>!s.done);  // 세부 일부 완료
  const wrapUp  = mids.length===0 && subs.some(s=>s.mid) && vd && due>=t1;         // 점검 모두 끝, 마감만 남음
  if(started||wrapUp) return 'doing';
  // 아직 손대지 않았고 내일 이후 점검/마감만 있는 것은 '예정 · 대기'
  return 'planned';
}
const PLACE_NAME={inbox:'분류 대기',today:'오늘 처리',doing:'진행 중',planned:'예정 · 대기',done:'완료'};

/* =========================================================================
   프리셋
   ========================================================================= */
const DEFAULT_PRESETS=[];
let PRESETS = STORE.loadPresets() || JSON.parse(JSON.stringify(DEFAULT_PRESETS));
window.PRESETS = PRESETS;
function savePresets(){ STORE.savePresets(PRESETS); window.PRESETS=PRESETS; }
function renderPresets(){
  const w=$('presets');
  w.innerHTML = PRESETS.map((p,i)=>
    `<span class="preset-wrap"><button class="preset" data-p="${i}">＋ ${esc(p.label)}</button><button class="preset-del" data-pdel="${i}" title="이 프리셋 삭제">×</button></span>`
  ).join('') + `<button class="preset preset-new" id="presetNewBtn">＋ 프리셋 관리</button>`;
}
$('presets').addEventListener('click',e=>{
  const del=e.target.closest('[data-pdel]');
  if(del){ const i=+del.dataset.pdel,p=PRESETS[i];
    if(confirm(`프리셋 "${p.label}"을(를) 삭제할까요?`)){ PRESETS.splice(i,1); savePresets(); renderPresets(); } return; }
  if(e.target.closest('#presetNewBtn')){ openPresetModal(); return; }
  const b=e.target.closest('.preset'); if(!b||b.id==='presetNewBtn')return;
  const p=PRESETS[+b.dataset.p]; if(!p)return;
  openForm({memo:p.sum, subs:(p.subs||[]).map(t=>({title:t,mid:''}))});
});
renderPresets();

/* =========================================================================
   (1) 바로 입력 → 분류 대기 (자유 입력 = 메모)
   ========================================================================= */
function toInbox(){
  const t=$('inp').value.trim(); if(!t){$('inp').focus();return;}
  items.push({id:newId(), memo:t, done:false, staged:true,
    f:{received:new Date().toISOString()}, contacts:[], ids:[], subs:[], al:{}});
  $('inp').value=''; persist(); $('inp').focus();
}
$('toInbox').addEventListener('click', toInbox);
$('inp').addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();toInbox();} });

/* =========================================================================
   (2) 양식 패널
   ========================================================================= */
let editingId=null;
// 팝업이 어느 탭에서든 뜨도록 formPanel을 body 직속으로 이동
document.body.appendChild($('formPanel'));
function openForm(pre){
  pre=pre||{};
  editingId=pre.id||null;
  $('fm-title').textContent=editingId?'양식 채우기 — 저장하면 규칙에 따라 자동 배치됩니다':'양식 입력';
  $('fm-memo').value = pre.memo || '';

  // 상위 시각 필드 (접수·마감)
  const g=$('fm-grid'); g.innerHTML='';
  enabled().forEach(f=>{
    const v=(pre.f||{})[f.key] ?? (f.key==='received'?new Date().toISOString():'');
    g.insertAdjacentHTML('beforeend',
      `<div class="fm-field"><label>${esc(f.label)}</label>${dtInputHtml('fm-dt', v, `data-fkey="${f.key}"`)}</div>`);
  });
  g.querySelectorAll('.dt-inp').forEach(refreshDow);

  // 관련인 세트
  const cw=$('fm-contacts'); cw.innerHTML='';
  const contacts = pre.contacts && pre.contacts.length ? pre.contacts : [{who:'',org:'',phone:''}];
  contacts.forEach(c=>addContactRow(c));

  // 식별번호
  const iw=$('fm-ids'); iw.innerHTML='';
  (pre.ids||[]).forEach(x=>addFormIdRow(x.kind,x.val));

  // 세부 할일
  const sw=$('fm-subs'); sw.innerHTML='';
  (pre.subs||[]).forEach(s=>addFormSubRow(s.title,s.mid,false,s));
  if(!(pre.subs||[]).length) addFormSubRow('','');

  updatePlacePreview();
  $('formPanel').classList.add('on');
  const m=$('fm-memo'); m.focus();
  const pos=m.value.indexOf('○○'); if(pos>=0)m.setSelectionRange(pos,pos+2);
}

/* 관련인 행 */
function addContactRow(c){
  c=c||{who:'',org:'',phone:''};
  const row=document.createElement('div'); row.className='contact-row';
  row.innerHTML=`
    <input type="text" class="c-org" placeholder="관련소속" value="${escAttr(c.org||'')}">
    <input type="text" class="c-who" placeholder="관련인" value="${escAttr(c.who||'')}">
    <input type="text" class="c-phone" placeholder="연락처" value="${escAttr(c.phone||'')}">
    <button class="rm" title="삭제">×</button>`;
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('fm-contacts').appendChild(row);
}
$('fm-contactadd').addEventListener('click',()=>addContactRow());

/* 식별번호 행 */
function idKindOptions(){ return ID_KINDS.concat(['기타']); }
function addFormIdRow(kind,val){
  const row=document.createElement('div'); row.className='fid-row';
  const opts=idKindOptions();
  const isEtc = !!kind && !ID_KINDS.includes(kind);
  const sel = opts.map(k=>{ const s=(k===kind||(k==='기타'&&isEtc))?' selected':''; return `<option value="${escAttr(k)}"${s}>${esc(k)}</option>`; }).join('');
  row.innerHTML=`<select class="fid-kind">${sel}</select>`
    + `<input type="text" class="fid-etc" placeholder="명칭 직접입력" value="${isEtc?escAttr(kind):''}" style="${isEtc?'':'display:none'}">`
    + `<input type="text" class="fid-val" placeholder="번호 입력" value="${escAttr(val||'')}">`
    + `<button class="rm" title="삭제">×</button>`;
  const selEl=row.querySelector('.fid-kind'), etcEl=row.querySelector('.fid-etc');
  selEl.addEventListener('change',()=>{ if(selEl.value==='기타'){etcEl.style.display='';etcEl.focus();} else etcEl.style.display='none'; });
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('fm-ids').appendChild(row);
}
$('fm-idadd').addEventListener('click',()=>{
  addFormIdRow(ID_KINDS[0]||'기타','');
});

/* 세부 할일 행 (Enter → 다음 줄 자동 생성) */
function addFormSubRow(title,mid,focusIt,sub){
  sub=sub||{};
  const row=document.createElement('div'); row.className='fsub-row';
  if(sub.id!=null) row.dataset.subid=sub.id;
  row.dataset.done = sub.done?'1':'0';
  const md=mid?{date:isoToDateStr(mid),time:isoToTimeStr(mid)}:{date:'',time:''};
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <div class="fsub-chk chk ${sub.done?'on':''}" title="완료 표시"></div>
    <input type="text" class="fsub-title" placeholder="세부 할 일" value="${escAttr(title||'')}">
    <span class="dt-inp fsub-dt">${dtInner(md.date, md.time)}</span>
    <button class="rm" title="삭제">×</button>`;
  const chk=row.querySelector('.fsub-chk');
  chk.addEventListener('click',()=>{ const on=row.dataset.done==='1'; row.dataset.done=on?'0':'1'; chk.classList.toggle('on',!on);
    row.querySelector('.fsub-title').classList.toggle('sdone',!on); });
  if(sub.done) row.querySelector('.fsub-title').classList.add('sdone');
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  const titleInput=row.querySelector('.fsub-title');
  titleInput.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault();
      const rows=[...$('fm-subs').querySelectorAll('.fsub-row')];
      const isLast = rows[rows.length-1]===row;
      if(isLast){ addFormSubRow('','',true); }
      else { const next=rows[rows.indexOf(row)+1]; next&&next.querySelector('.fsub-title').focus(); }
    }
  });
  $('fm-subs').appendChild(row);
  refreshDow(row.querySelector('.dt-inp'));
  if(focusIt) titleInput.focus();
}
$('fm-subadd').addEventListener('click',()=>addFormSubRow('','',true));
enableDragReorder($('fm-subs'), '.fsub-row', '.drag-handle');

function collectForm(){
  const f={};
  $('fm-grid').querySelectorAll('[data-fkey]').forEach(sp=>{ const v=readDtInput(sp); f[sp.dataset.fkey] = (v===null?'':v); });
  const contacts=[...$('fm-contacts').querySelectorAll('.contact-row')].map(r=>({
    who:r.querySelector('.c-who').value.trim(), org:r.querySelector('.c-org').value.trim(), phone:r.querySelector('.c-phone').value.trim()
  })).filter(c=>c.who||c.org||c.phone);
  const ids=[...$('fm-ids').querySelectorAll('.fid-row')].map(r=>{
    const sel=r.querySelector('.fid-kind').value, etc=r.querySelector('.fid-etc').value.trim(), val=r.querySelector('.fid-val').value.trim();
    const kind=sel==='기타'?(etc||'기타'):sel; return val?{kind,val}:null;
  }).filter(Boolean);
  const subs=[...$('fm-subs').querySelectorAll('.fsub-row')].map(r=>{
    const t=r.querySelector('.fsub-title').value.trim(); if(!t)return null;
    const dt=r.querySelector('.fsub-dt'); const raw=readDtInput(dt); const mid=(raw===null?'':raw);
    const id = r.dataset.subid!=null && r.dataset.subid!=='' ? Number(r.dataset.subid) : newId();
    const done = r.dataset.done==='1';
    // 기존 세부의 알람 확인 상태(al) 보존. 단 점검시각이 바뀌면 알람 재무장.
    let al={};
    if(editingId){ const cur=items.find(x=>x.id===editingId); const prev=cur&&(cur.subs||[]).find(s=>s.id===id);
      if(prev){ al = (prev.mid===mid) ? (prev.al||{}) : {}; } }
    return {id, title:t, mid, done, al};
  }).filter(Boolean);
  return {memo:$('fm-memo').value.trim(), f, contacts, ids, subs};
}
function updatePlacePreview(){ try{ const d=collectForm(); const p=placeOf({staged:false,f:d.f,subs:d.subs}); $('fm-place').innerHTML=`저장 위치: <b>${PLACE_NAME[p]}</b>`; }catch{} }
$('blankForm').addEventListener('click',()=>{ const t=$('inp').value.trim(); openForm(t?{memo:t}:{}); if(t)$('inp').value=''; });
$('fm-cancel').addEventListener('click',()=>{$('formPanel').classList.remove('on');editingId=null;});
$('formPanel').addEventListener('input',e=>{ if(e.target.closest('#fm-grid,#fm-subs')) updatePlacePreview(); });
$('fm-save').addEventListener('click',()=>{
  // F3: 저장 전 오입력 검사 (포커스 남아있으면 판정되도록 먼저 blur)
  if(document.activeElement && $('formPanel').contains(document.activeElement)) document.activeElement.blur();
  if(!validateAllDt($('formPanel'))){
    alert('날짜·시각 입력이 올바르지 않습니다.\n빨갛게 표시된 칸을 확인해주세요.\n(예: 2026/07/10 · 18:30)');
    return;
  }
  const d=collectForm();
  if(editingId){
    const it=items.find(x=>x.id===editingId);
    if(it){
      const oldDue=(it.f||{}).due;
      it.memo=d.memo; it.f=d.f; it.contacts=d.contacts; it.ids=d.ids; it.subs=d.subs; it.staged=false;
      it.al = it.al || {};
      if(oldDue !== d.f.due) delete it.al.due;   // F2: 마감이 바뀌면 알람 재무장
    }
  }else{
    items.push({id:newId(), memo:d.memo, done:false, staged:false, f:d.f, contacts:d.contacts, ids:d.ids, subs:d.subs, al:{}});
  }
  $('formPanel').classList.remove('on'); editingId=null; persist();
});

/* =========================================================================
   프리셋 관리 모달
   ========================================================================= */
function openPresetModal(){ renderPresetList(); clearPresetForm(); renderIdKindList(); $('presetModal').classList.add('on'); }

/* 식별번호 명칭 관리 */
function renderIdKindList(){
  const w=$('idKindList');
  if(!ID_KINDS.length){ w.innerHTML='<div class="empty" style="padding:10px">명칭이 없습니다. 아래에서 추가하세요.</div>'; return; }
  w.innerHTML=ID_KINDS.map((k,i)=>`<div class="idk-item" data-idk="${escAttr(k)}">
    <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <span class="idk-name">${esc(k)}</span>
    <button class="ps-del" data-idkdel="${i}">삭제</button></div>`).join('');
}
$('idKindList').addEventListener('click',e=>{
  const d=e.target.closest('[data-idkdel]'); if(!d)return;
  const i=+d.dataset.idkdel, name=ID_KINDS[i];
  const used=items.some(it=>(it.ids||[]).some(x=>x.kind===name));
  const msg = used ? `"${name}"은(는) 이미 입력된 업무에서 사용 중입니다.\n삭제해도 기존 업무의 값은 그대로 남고, 앞으로 목록에만 안 나옵니다.\n삭제할까요?`
                   : `명칭 "${name}"을(를) 삭제할까요?`;
  if(confirm(msg)){ ID_KINDS.splice(i,1); saveIdKinds(); renderIdKindList(); }
});
$('idk-add').addEventListener('click',()=>{
  const v=$('idk-new').value.trim();
  if(!v){ $('idk-new').focus(); return; }
  if(v==='기타'){ alert("'기타'는 항상 자동 포함되므로 추가할 수 없습니다."); return; }
  if(ID_KINDS.includes(v)){ alert('이미 있는 명칭입니다.'); return; }
  ID_KINDS.push(v); saveIdKinds(); $('idk-new').value=''; renderIdKindList(); $('idk-new').focus();
});
$('idk-new').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();$('idk-add').click();} });
enableDragReorder($('idKindList'), '.idk-item', '.drag-handle', (container)=>{
  const order=[...container.querySelectorAll('.idk-item')].map(el=>el.dataset.idk);
  ID_KINDS.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  saveIdKinds(); renderIdKindList();
});
$('presetClose').addEventListener('click',()=>$('presetModal').classList.remove('on'));
function renderPresetList(){
  const w=$('presetList');
  if(!PRESETS.length){ w.innerHTML='<div class="empty">저장된 프리셋이 없습니다.</div>'; return; }
  w.innerHTML=PRESETS.map((p,i)=>`<div class="ps-item" data-pid="${esc(p.id)}"><span class="drag-handle" title="드래그하여 순서 변경">⠿</span><div class="ps-body">
    <div class="ps-name">${esc(p.label)}</div><div class="ps-sum">${esc(p.sum||'')}</div>
    ${(p.subs&&p.subs.length)?`<div class="ps-subs">세부: ${p.subs.map(esc).join(' · ')}</div>`:''}
    </div><button class="ps-edit" data-edit="${i}">수정</button><button class="ps-del" data-del="${i}">삭제</button></div>`).join('');
}
let editingPresetId=null;
enableDragReorder($('presetList'), '.ps-item', '.drag-handle', (container)=>{
  const order=[...container.querySelectorAll('.ps-item')].map(el=>el.dataset.pid);
  PRESETS.sort((a,b)=>order.indexOf(String(a.id))-order.indexOf(String(b.id)));
  savePresets(); renderPresets(); renderPresetList();
});
$('presetList').addEventListener('click',e=>{
  const ed=e.target.closest('.ps-edit');
  if(ed){ loadPresetIntoForm(+ed.dataset.edit); return; }
  const d=e.target.closest('.ps-del'); if(!d)return;
  const p=PRESETS[+d.dataset.del];
  if(confirm(`프리셋 "${p.label}"을(를) 삭제할까요?`)){ PRESETS.splice(+d.dataset.del,1); savePresets(); renderPresetList(); renderPresets(); if(editingPresetId===p.id)clearPresetForm(); }
});
function loadPresetIntoForm(idx){
  const p=PRESETS[idx]; if(!p)return;
  editingPresetId=p.id;
  $('np-label').value=p.label; $('np-sum').value=p.sum||'';
  $('np-subs').innerHTML=''; (p.subs||[]).forEach(t=>addPresetSubRow(t));
  $('np-save').textContent='프리셋 수정 저장';
  $('np-new-head').textContent='✎ 프리셋 수정 중';
  $('np-cancel-edit').style.display='inline-block';
  $('np-label').focus();
}
function addPresetSubRow(val){
  const row=document.createElement('div'); row.className='fsub-row';
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <input type="text" placeholder="세부 할 일" value="${escAttr(val||'')}"><button class="rm" title="삭제">×</button>`;
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('np-subs').appendChild(row);
}
function clearPresetForm(){ $('np-label').value=''; $('np-sum').value=''; $('np-subs').innerHTML=''; editingPresetId=null;
  $('np-save').textContent='프리셋 저장'; if($('np-new-head'))$('np-new-head').textContent='＋ 새 프리셋 만들기'; if($('np-cancel-edit'))$('np-cancel-edit').style.display='none'; }
$('np-subadd').addEventListener('click',()=>addPresetSubRow(''));
enableDragReorder($('np-subs'), '.fsub-row', '.drag-handle'); // np-save가 DOM 순서 그대로 읽으므로 onDrop 콜백 불필요 (fm-subs와 동일 패턴)
$('np-cancel-edit').addEventListener('click',()=>clearPresetForm());
$('np-save').addEventListener('click',()=>{
  const label=$('np-label').value.trim(); if(!label){alert('버튼 이름을 입력하세요.');$('np-label').focus();return;}
  const sum=$('np-sum').value.trim();
  const subs=[...$('np-subs').querySelectorAll('input[type=text]')].map(i=>i.value.trim()).filter(Boolean);
  if(editingPresetId){
    const p=PRESETS.find(x=>x.id===editingPresetId);
    if(p){ p.label=label; p.sum=sum||label; p.subs=subs; }
  }else{
    PRESETS.push({id:'p'+Date.now(), label, sum:sum||label, subs});
  }
  savePresets(); renderPresets(); renderPresetList(); clearPresetForm();
});

/* =========================================================================
   렌더
   ========================================================================= */
let q='', dq='';

function contactText(it){ return (it.contacts||[]).map(c=>`${c.who} ${c.org} ${c.phone}`).join(' '); }
function idText(it){ return (it.ids||[]).map(x=>`${x.kind} ${x.val}`).join(' '); }
function haystack(it){ return ((it.memo||'')+' '+contactText(it)+' '+idText(it)+' '+(it.subs||[]).map(s=>s.title).join(' ')).toLowerCase(); }
function matchesQ(it){ return !q || haystack(it).includes(q); }

const DOW=['일','월','화','수','목','금','토'];
function fmtT(iso){ if(!iso)return null; const d=new Date(iso); if(isNaN(d))return null;
  return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function fmtDue(iso){ if(!iso)return null; const d=new Date(iso); if(isNaN(d))return null;   // F7: 손상 ISO 방어
  const now=new Date(); const m=Math.round((d-now)/60000);
  let cls='',note=''; if(m<0){cls='late';note=' 지남';} else if(m<=60){cls='soon';note=` ${m}분후`;} else if(m<=240){cls='soon';note=` ${Math.round(m/60)}시간후`;}
  const lbl=fmtT(iso); if(lbl===null) return null;
  return {label:lbl+note,cls}; }

function alarmDot(obj,key){
  const iso=key==='due'?(obj.f||{}).due:obj.mid;
  if(!iso) return '';
  const t=new Date(iso).getTime();
  if(isNaN(t)) return '';
  const st=(obj.al||{})[key];
  const passed=t<=Date.now();
  let cls,tip;
  if(st===true){ cls='ad-done'; tip='알람 확인함'; }                       // ● 확인됨(초록)
  else if(typeof st==='number'){                                            // F6: 스누즈 중
    cls='ad-snooze';
    const at=new Date(st);
    tip = isNaN(at) ? '알람 미룸' : `알람 미룸 — ${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')} 재알림`;
  }
  else if(passed){ cls='ad-ring'; tip='알람 울림 (미확인)'; }               // ● 울림(빨강)
  else { cls='ad-wait'; tip='알람 대기'; }                                  // ○ 대기
  return `<span class="adot ${cls}" title="${escAttr(tip)}"></span>`;
}
/* 카드에 보일 세부 할일: 앞으로 도래할 것 중 가장 가까운 것.
   그런 게 없고 '이미 지난 미완료' 점검이 있으면 그것을 (지남 표시로) 보여줌. */
function earliestSub(it){
  const now=Date.now();
  const pend=(it.subs||[]).filter(s=>!s.done && s.mid);
  if(!pend.length) return null;
  const future=pend.filter(s=>new Date(s.mid).getTime()>now).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  if(future[0]) return future[0];
  const past=pend.filter(s=>new Date(s.mid).getTime()<=now).sort((a,b)=>new Date(b.mid)-new Date(a.mid));
  return past[0]||null;   // 가장 최근에 지난 것
}
/* 정렬 기준: 가장 가까운 미래 세부 시각 (없으면 null) */
function nextSubTime(it){
  const now=Date.now();
  const t=(it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid).getTime()).filter(x=>x>now).sort((a,b)=>a-b);
  return t.length?t[0]:null;
}
/* 카드 겉면: 메모(2줄) · 가장 임박한 세부 할일 · 마감시각 만.
   관련인/식별번호는 카드에서 감추고 팝업에서만 표시. */
function dueTagHtml(it){
  const v=(it.f||{}).due; if(!v) return '';
  const m=fmtDue(v); if(!m) return '';        // F7: 손상 ISO면 렌더 생략
  // adot는 태그(pill) 밖에 둔다 — 세부(mid) 쪽과 동일하게. pill 안에 넣으면
  // '대기'(ad-wait) 상태의 투명 배경이 pill 색과 겹쳐 항상 칠해진 것처럼 보인다.
  return `${alarmDot(it,'due')}<span class="tag time ${m.cls}"><span class="k">#마감:</span>${esc(m.label)}</span>`;
}
function cardHtml(it,place){
  const due=fmtDue((it.f||{}).due);
  const urg=due&&!it.done&&(due.cls==='late'||due.cls==='soon')?' urgent':'';
  const subs=it.subs||[];
  const memo=(it.memo||'').trim();
  const memoHtml = memo ? esc(memo) : '<span style="color:var(--ink-soft)">(메모 없음)</span>';
  const es=earliestSub(it);
  const progress = subs.length?`<span class="mini-prog">세부 ${subs.filter(s=>s.done).length}/${subs.length}</span>`:'';
  let subLine='';
  if(es){
    const m=es.mid?fmtDue(es.mid):null;
    subLine=`<div class="card-subline">▸ <span class="sub-title">${esc(es.title)}</span>${m?`${alarmDot(es,'mid')}<span class="sub-when ${m.cls==='late'?'late':''}">${esc(m.label)}</span>`:''}</div>`;
  }
  return `<div class="card p-${place}${it.done?' done':''}${urg}" data-open="${it.id}">
    <div class="card-top">
      <div class="chk ${it.done?'on':''}" data-id="${it.id}"></div>
      <div class="card-body">
        <div class="card-memo">${memoHtml}</div>
        ${subLine}
        <div class="card-meta">${dueTagHtml(it)}${progress}</div>
      </div>
      <button class="del" data-del="${it.id}" title="삭제">×</button>
    </div></div>`;
}
function updateStrip(){
  const now=new Date(); let late=0;
  items.forEach(it=>{ if(it.done)return; const d=(it.f||{}).due?new Date(it.f.due):null; if(d&&!isNaN(d)&&d<now)late++; });
  $('st-late').textContent=late; $('st-late-wrap').style.display=late?'flex':'none';
}
function render(){
  const cols={inbox:[],today:[],doing:[],planned:[]};
  items.filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
  /* 정렬: 현재 시각에 가까운 것이 위로.
     ① 지난 미완료 점검(최근에 지난 것이 위) → ② 다가올 점검(가까운 것이 위)
     → ③ 마감시각(가까운 것이 위) → ④ 최신 등록 */
  const overdueSub=(it)=>{ const now=Date.now();
    const t=(it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid).getTime()).filter(x=>x<=now).sort((a,b)=>a-b);
    return t.length?t[0]:null; };
  const sorter=(a,b)=>{
    const ao=overdueSub(a), bo=overdueSub(b);
    if(ao!=null&&bo!=null&&ao!==bo) return bo-ao;   // 최근에 지난 것(현재와 가까운 것)이 위
    if(ao!=null&&bo==null) return -1;
    if(ao==null&&bo!=null) return 1;
    const as=nextSubTime(a), bs=nextSubTime(b);
    if(as!=null&&bs!=null&&as!==bs) return as-bs;
    if(as!=null&&bs==null) return -1;
    if(as==null&&bs!=null) return 1;
    const ad=(a.f||{}).due?new Date(a.f.due).getTime():null;
    const bd=(b.f||{}).due?new Date(b.f.due).getTime():null;
    if(ad!=null&&bd!=null&&ad!==bd) return ad-bd;
    if(ad!=null&&bd==null) return -1;
    if(ad==null&&bd!=null) return 1;
    return b.id-a.id;
  };
  const EMPTY={inbox:'자유 입력이 여기 쌓입니다.',today:'오늘 마감·점검 건이 없습니다.<br><b>여유 있는 날</b>',doing:'진행 중인 업무가 없습니다.',planned:'예정 건이 없습니다.'};
  for(const k of ['inbox','today','doing','planned']){
    const list=cols[k].sort(sorter);
    $('c-'+k).textContent=list.length;
    $('col-'+k).innerHTML=list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':EMPTY[k]}</div>`;
  }
  updateStrip(); renderCal(); renderDone();
}
function renderDone(){
  const list=items.filter(it=>it.done).filter(it=>!dq||haystack(it).includes(dq)).sort((a,b)=>(b.doneAt||b.id)-(a.doneAt||a.id));
  $('done-count').textContent=items.filter(it=>it.done).length;
  $('col-done').innerHTML=list.length?list.map(it=>cardHtml(it,'done')).join(''):`<div class="empty">${dq?'검색 결과가 없습니다.':'완료된 업무가 없습니다.'}</div>`;
}
/* F8: 숫자 등 비문자열이 들어와도 죽지 않도록 문자열화 */
function esc(s){return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
/* F11: '&'를 먼저 이스케이프해야 편집 왕복 시 &amp; 가 &로 붕괴하지 않음 */
function escAttr(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
async function persist(){ window.items=items; await STORE.saveAll(items); render(); askNotify(); }

/* 실행취소 토스트 */
let _toastTimer=null,_undoFn=null;
function showToast(msg,undoFn){ $('toast-msg').textContent=msg; _undoFn=undoFn||null; $('toast-undo').style.display=undoFn?'inline-block':'none';
  $('toast').classList.add('on'); clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>{$('toast').classList.remove('on');_undoFn=null;},6000); }
$('toast-undo').addEventListener('click',()=>{ if(_undoFn){const fn=_undoFn;_undoFn=null;$('toast').classList.remove('on');clearTimeout(_toastTimer);fn();} });

/* 카드 상호작용 */
document.body.addEventListener('click',e=>{
  const chk=e.target.closest('.chk');
  if(chk&&chk.dataset.id){ e.stopPropagation(); const it=items.find(x=>x.id==chk.dataset.id); if(it){it.done=!it.done; it.doneAt=it.done?Date.now():null; persist();} return; }
  const del=e.target.closest('.del');
  if(del&&del.dataset.del){ e.stopPropagation(); const id=+del.dataset.del; const idx=items.findIndex(x=>x.id==id);
    if(idx>=0){
      items.splice(idx,1); persist(); showToast('업무를 영구 삭제했습니다');
    } return; }
  const open=e.target.closest('[data-open]');
  if(open){ const it=items.find(x=>x.id==open.dataset.open); if(it)openForm(it); return; }
});
/* 주기 재렌더 — 편집 중 보호 */
setInterval(()=>{ const a=document.activeElement;
  if(a&&(a.matches('#search,#done-search,#inp,.dt-date,.dt-time')||a.closest('#formPanel,#presetModal')))return;
  render(); },60000);

/* Ctrl+S: 양식 팝업 열려 있으면 저장, 아니면 JSON 백업 */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey) && (e.key==='s'||e.key==='S')){
    e.preventDefault();
    if($('formPanel').classList.contains('on')){ $('fm-save').click(); }
    else if($('presetModal').classList.contains('on')){ $('np-save').click(); }
    else { $('bkExp').click(); }
  }
});
/* F14: ESC 로 팝업 닫기. 배경 클릭 닫기는 드래그 선택 시 오작동하므로 의도적으로 제외.
   알람 모달은 명시적 확인이 필요하므로 대상에서 제외. */
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if($('formPanel').classList.contains('on')){ $('formPanel').classList.remove('on'); editingId=null; return; }
  if($('presetModal').classList.contains('on')){ $('presetModal').classList.remove('on'); return; }
});

function tickClock(){ const n=new Date();
  $('clock').textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const days=['일','월','화','수','목','금','토']; $('today').textContent=`${n.getFullYear()}. ${n.getMonth()+1}. ${n.getDate()} (${days[n.getDay()]})`; }
setInterval(tickClock,1000); tickClock();

/* 검색 */
$('search').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();render();});
$('done-search').addEventListener('input',e=>{dq=e.target.value.trim().toLowerCase();renderDone();});

/* =========================================================================
   알람 — 마감 + 세부 점검시각
   ========================================================================= */
let notifyAsked=false;
function askNotify(){ if(notifyAsked||!('Notification'in window))return; notifyAsked=true; if(Notification.permission==='default'){try{Notification.requestPermission();}catch{}} }
/* AudioContext는 재사용 — 알람마다 새로 만들면 브라우저 엔진의 동시 생성
   상한(약 6개)에 걸려 몇 번 울린 뒤부터 소리가 조용히 죽는다 */
let _audioCtx=null;
function beep(){ try{ const ctx=_audioCtx=_audioCtx||new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==='suspended')ctx.resume(); const g=ctx.createGain(); g.connect(ctx.destination); g.gain.value=.15;
  [0,.28].forEach(t=>{const o=ctx.createOscillator();o.type='sine';o.frequency.value=880;o.connect(g);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+.16);}); }catch{} }
let firedNow=[];
function checkAlarms(){
  if(!SETTINGS.alarmOn) return;
  if($('alarmBg').classList.contains('on')) return;   // F5: 모달이 이미 떠 있으면 재알림 금지
  const now=Date.now(); const fire=[];
  const test=(obj,key,iso,label,title)=>{ if(!iso)return; const t=new Date(iso).getTime(); if(isNaN(t)||now<t)return;
    obj.al=obj.al||{}; const st=obj.al[key]; if(st===true)return; if(typeof st==='number'&&now<st)return; fire.push({obj,key,label,title,iso}); };
  items.forEach(it=>{ if(it.done)return;
    test(it,'due',(it.f||{}).due,'마감',it.memo||'');
    (it.subs||[]).forEach(s=>{ if(!s.done)test(s,'mid',s.mid,'중간점검',s.title); });
  });
  if(!fire.length)return; firedNow=fire;
  $('alarmList').innerHTML=fire.map(a=>`<div class="a-item"><b>#${a.label}</b>${esc(a.title||'(메모 없음)')}<span class="mono">${fmtT(a.iso)}</span></div>`).join('');
  $('alarmBg').classList.add('on'); beep(); try{window.focus();}catch{} startTitleFlash(fire.length);
  invoke('focus_main_window').catch(()=>{}); // window.focus() can't steal OS focus from another app; this can
  if('Notification'in window&&Notification.permission==='granted'){ fire.forEach(a=>{try{
    const nt=new Notification('뭐해야 했더라 — '+a.label,{body:a.title||'',tag:'wmhh-'+a.key+'-'+a.iso});
    nt.onclick=()=>{ try{window.focus();}catch{} try{nt.close();}catch{} };
  }catch{}}); }
}
let _titleFlash=null; const _baseTitle=document.title;
function startTitleFlash(n){
  stopTitleFlash();
  let on=false;
  _titleFlash=setInterval(()=>{ on=!on; document.title = on ? `🔔 알림 ${n}건 — 확인하세요` : _baseTitle; },900);
}
function stopTitleFlash(){ if(_titleFlash){ clearInterval(_titleFlash); _titleFlash=null; } document.title=_baseTitle; }
// 창을 다시 보면 깜빡임 중지
window.addEventListener('focus',stopTitleFlash);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) stopTitleFlash(); });
$('alarmOk').addEventListener('click',()=>{ firedNow.forEach(a=>{a.obj.al=a.obj.al||{};a.obj.al[a.key]=true;}); firedNow=[]; $('alarmBg').classList.remove('on'); stopTitleFlash(); persist(); });
$('alarmSnooze').addEventListener('click',()=>{ firedNow.forEach(a=>{a.obj.al=a.obj.al||{};a.obj.al[a.key]=Date.now()+6e5;}); firedNow=[]; $('alarmBg').classList.remove('on'); stopTitleFlash(); persist(); });
function renderAlarmToggle(){
  const b=$('alarmToggle'); if(!b)return;
  b.textContent = SETTINGS.alarmOn ? '🔔 알람 켜짐' : '🔕 알람 꺼짐';
  b.classList.toggle('alarm-off', !SETTINGS.alarmOn);
  b.title = SETTINGS.alarmOn ? '클릭하면 알람을 끕니다' : '클릭하면 알람을 켭니다';
}
$('alarmToggle').addEventListener('click',()=>{
  SETTINGS.alarmOn=!SETTINGS.alarmOn; saveSettings(); renderAlarmToggle();
  if(!SETTINGS.alarmOn){ $('alarmBg').classList.remove('on'); firedNow=[]; stopTitleFlash(); }
  showToast(SETTINGS.alarmOn?'알람을 켰습니다':'알람을 껐습니다');
});
renderAlarmToggle();
setInterval(checkAlarms,20000); setTimeout(checkAlarms,2500);

/* 탭 */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
  const v=t.dataset.view;
  $('view-board').style.display=v==='board'?'grid':'none';
  $('strip').style.display=v==='board'?'flex':'none';
  $('view-cal').classList.toggle('on',v==='cal');
  $('view-done').classList.toggle('on',v==='done');
  $('capture').style.display=v==='board'?'block':'none';
  if(v==='cal')renderCal(); if(v==='done')renderDone();
}));
/* '완료 전체 비우기' 제거됨 */

/* 캘린더 */
let calY=new Date().getFullYear(), calM=new Date().getMonth(), calSel=null;
$('cal-prev').addEventListener('click',()=>{calM--;if(calM<0){calM=11;calY--;}calSel=null;renderCal();});
$('cal-next').addEventListener('click',()=>{calM++;if(calM>11){calM=0;calY++;}calSel=null;renderCal();});
$('cal-today').addEventListener('click',()=>{const n=new Date();calY=n.getFullYear();calM=n.getMonth();calSel=null;renderCal();});
/* 캘린더 이벤트: 세부 할일 우선. 세부 할일이 없으면 그 업무의 메모를 마감일에 표기.
   접수·마감 자체는 별도 표시하지 않음. */
function dayEvents(){
  const map={};
  const push=(iso,payload)=>{ if(!iso)return; const d=new Date(iso); if(isNaN(d))return;
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; (map[key]=map[key]||[]).push(Object.assign({iso},payload)); };
  items.forEach(it=>{
    const timed=(it.subs||[]).filter(s=>s.mid);
    if(timed.length){
      timed.forEach(s=>push(s.mid,{it,fkey:'mid',label:'점검',subTitle:s.title,subDone:s.done}));
    }else{
      // 세부 할일(시각 있는 것)이 없으면 메모를 마감일에
      push((it.f||{}).due,{it,fkey:'memo',label:'업무'});
    }
  });
  return map;
}
function pillClass(fkey){ return fkey==='mid'?'p-mid':'p-due'; }
function renderCal(){
  $('cal-title').textContent=`${calY}년 ${calM+1}월`;
  const g=$('cal-grid'); g.innerHTML='';
  ['일','월','화','수','목','금','토'].forEach((d,i)=>g.insertAdjacentHTML('beforeend',`<div class="cal-dow ${i===0?'sun':''}">${d}</div>`));
  const first=new Date(calY,calM,1); const start=new Date(first); start.setDate(1-first.getDay());
  const evMap=dayEvents(); const today=new Date();
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const other=d.getMonth()!==calM; const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const evs=(evMap[key]||[]).sort((a,b)=>new Date(a.iso)-new Date(b.iso));
    let pills=evs.slice(0,4).map(ev=>{ const t=new Date(ev.iso); const hm=`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
      const done = ev.fkey==='mid' ? ev.subDone : ev.it.done;
      const label = ev.fkey==='mid' ? ev.subTitle : (ev.it.memo||'(메모 없음)');
      return `<div class="pill ${pillClass(ev.fkey)}${done?' p-done':''}" title="${escAttr(ev.label+' · '+label)}">${hm} ${esc(label)}</div>`; }).join('');
    if(evs.length>4)pills+=`<div class="pill p-custom">+${evs.length-4}건</div>`;
    g.insertAdjacentHTML('beforeend',`<div class="cal-day${other?' other':''}${d.toDateString()===today.toDateString()?' today':''}${d.getDay()===0?' sun-d':''}${calSel===key?' sel':''}" data-key="${key}"><div class="dnum">${d.getDate()}</div>${pills}</div>`);
  }
}
$('cal-grid').addEventListener('click',e=>{
  const cell=e.target.closest('.cal-day'); if(!cell)return; calSel=cell.dataset.key; renderCal();
  const evs=(dayEvents()[calSel]||[]); const dt=$('cal-detail'); if(!evs.length){dt.classList.remove('on');return;}
  const [y,m,dd]=calSel.split('-').map(Number); const dObj=new Date(y,m,dd);
  $('cal-detail-title').textContent=`${y}년 ${m+1}월 ${dd}일 (${DOW[dObj.getDay()]}) — ${evs.length}건`;
  const seen=new Set(); $('cal-detail-cards').innerHTML=evs.filter(ev=>{if(seen.has(ev.it.id))return false;seen.add(ev.it.id);return true;}).map(ev=>cardHtml(ev.it,placeOf(ev.it))).join('');
  dt.classList.add('on');
});

/* XLSX */
$('xlsx').addEventListener('click', async ()=>{
  // 분류 대기·예정 항목은 아직 손 안 댄 메모라 보고용 목록에는 의미가 적어
  // 제외 — 오늘 처리·진행 중·완료(=실제로 다루고 있거나 다룬 업무)만 담는다.
  const exportable=items.filter(it=>it.done||['today','doing'].includes(placeOf(it)));
  if(!exportable.length){alert('내보낼 항목이 없습니다 (오늘 처리·진행 중·완료된 업무만 내보냅니다).');return;}
  const fx=iso=>{ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const rows=exportable.map(it=>{
    const subs=it.subs||[];
    return {
      '구역':PLACE_NAME[placeOf(it)],
      '메모':it.memo||'',
      '관련인':(it.contacts||[]).map(c=>c.who).filter(Boolean).join(', '),
      '관련소속':(it.contacts||[]).map(c=>c.org).filter(Boolean).join(', '),
      '연락처':(it.contacts||[]).map(c=>c.phone).filter(Boolean).join(', '),
      '접수시각':fx((it.f||{}).received),
      '마감시각':fx((it.f||{}).due),
      '식별번호':(it.ids||[]).map(x=>`${x.kind}: ${x.val}`).join(' · '),
      '세부진행':subs.length?`${subs.filter(s=>s.done).length}/${subs.length}`:'',
      '세부내역':subs.map(s=>(s.done?'[완료] ':'')+s.title+(s.mid?` (점검 ${fx(s.mid)})`:'')).join(' · ')
    };
  });
  const ws=XLSX.utils.json_to_sheet(rows); const cols=Object.keys(rows[0]);
  ws['!cols']=cols.map(c=>({wch:Math.max(10,Math.min(46,rows.reduce((m,r)=>Math.max(m,String(r[c]||'').length*1.7),c.length*2)))}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'업무목록');
  const n=new Date();
  const name=`뭐해야했더라_업무목록_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.xlsx`;
  // XLSX.writeFile()은 브라우저의 blob+<a download> 다운로드에 의존하는데,
  // Tauri 창은 그걸 받아줄 다운로드 관리자가 없어 조용히 아무 일도 안 일어난다
  // (JSON 백업도 같은 이유로 안 됐던 것과 동일한 원인) — 바이트를 직접 뽑아
  // 네이티브 저장 대화상자로 넘긴다.
  // F14: {type:'array'}는 이 SheetJS 빌드에서 length가 없는 순수 ArrayBuffer를
  // 반환해 Array.from()이 조용히 빈 배열을 만들어버린다(= 0바이트 파일, "파일 형식
  // 문제"로 안 열림) — Uint8Array로 감싸야 실제 바이트가 나온다.
  const bytes=Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
  try{
    const saved=await invoke('save_binary_file', {suggestedName:name, data:bytes});
    if(saved) showToast('XLSX 파일을 저장했습니다');
  }catch(e){ alert('XLSX 저장 실패: '+e); }
});

/* 저장 파일 버튼 */
/* [JSON파일 백업] / Ctrl+S — 저장창을 띄워 폴더·이름 지정.
   한 번 지정하면 그 파일 핸들을 기억해 이후엔 같은 파일에 조용히 저장. */
function backupPayload(){ return JSON.stringify({v:5,exported:new Date().toISOString(),fields:FIELDS,presets:PRESETS,idKinds:ID_KINDS,settings:SETTINGS,items},null,1); }
function backupName(){ const n=new Date(); return `뭐해야했더라_백업_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.json`; }
async function doBackup(){
  const text=backupPayload();
  // Tauri 창은 브라우저가 아니라 blob+<a download> 클릭을 받아줄 다운로드
  // 관리자가 없다 — 네이티브 "저장" 대화상자를 직접 띄워야 실제로 저장된다.
  try{
    const saved=await invoke('save_text_file', {suggestedName:backupName(), content:text});
    if(saved) showToast('백업 파일을 저장했습니다');
  }catch(e){ alert('백업 저장 실패: '+e); }
}
function reconcileImported(){
  if(window.__importedPresets){ PRESETS=window.__importedPresets; window.__importedPresets=null; window.PRESETS=PRESETS; STORE.savePresets(PRESETS); renderPresets(); }
  if(window.__importedIdKinds){ ID_KINDS=window.__importedIdKinds.filter(k=>k&&k!=='기타'); window.__importedIdKinds=null; window.ID_KINDS=ID_KINDS; STORE.saveIdKinds(ID_KINDS); }
  if(window.__importedSettings){ SETTINGS=Object.assign({},DEFAULT_SETTINGS,window.__importedSettings); window.__importedSettings=null; window.SETTINGS=SETTINGS; STORE.saveSettings(SETTINGS); if(typeof renderAlarmToggle==='function')renderAlarmToggle(); }
  if(window.__importedFields){ let imp=window.__importedFields; window.__importedFields=null;
    const custom=imp.filter(f=>!CORE_FIELDS.some(cf=>cf.key===f.key)&&!['who','org','phone','mid','notice','sr'].includes(f.key));
    FIELDS=CORE_FIELDS.map(cf=>{const ex=imp.find(x=>x.key===cf.key);return ex?Object.assign({},cf,{on:true,builtin:true}):JSON.parse(JSON.stringify(cf));}).concat(custom);
    window.FIELDS=FIELDS; STORE.saveFields(FIELDS); }
}

/* 저장 위치 변경 */
$('dataDirBtn').addEventListener('click', async e=>{
  e.preventDefault();
  let cur; try{ cur=await invoke('get_data_dir'); }catch(err){ alert('저장 위치 확인 실패: '+err); return; }
  if(!confirm(`현재 저장 위치:\n${cur}\n\n다른 위치로 변경할까요?\n(아무 위치나 고르시면 그 안에 전용 폴더를 새로 만듭니다. 데이터는 다음 재시작 때 그 시점의 최신 상태 그대로 새 위치로 옮겨집니다)`))return;
  let picked; try{ picked=await invoke('choose_data_dir'); }catch(err){ alert('위치 선택 실패: '+err); return; }
  if(!picked)return; // 취소함
  if(confirm(`새 저장 위치가 예약되었습니다:\n${picked}\n\n다시 시작할 때 데이터가 새 위치로 옮겨집니다. 지금 재시작할까요?\n(나중에 재시작해도 그때까지의 수정 내용이 전부 함께 옮겨지니 안전합니다)`)){
    invoke('restart_app');
  }
});

/* 백업/복원 */
$('bkExp').addEventListener('click',e=>{ e.preventDefault(); doBackup(); });

/* 불러오기 — JSON 백업과 DB(.sqlite) 파일 중 아무거나 하나의 파일 선택창으로
   고를 수 있다. JSON은 즉시 반영(재시작 불필요), DB 파일은 통째로 교체 후
   재시작이 필요하다(저장 위치 변경과 동일한 이유 — 열려있는 SQLite 연결을
   그대로 두고 파일만 바꾸는 게 아니라, 안전하게 다시 여는 쪽이 단순하고
   확실하다). */
$('bkImp').addEventListener('click', async e=>{
  e.preventDefault();
  let result;
  try{ result=await invoke('import_backup_file'); }
  catch(err){ alert('불러오기 실패: '+err); return; }
  if(result.kind==='Cancelled')return;

  if(result.kind==='Json'){
    let d;
    try{ d=JSON.parse(result.content); if(!Array.isArray(d.items))throw 0; }
    catch{ alert('백업 파일 형식이 올바르지 않습니다.'); return; }
    if(!confirm(`백업 파일에 업무 ${d.items.length}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?`))return;
    // 구버전 백업 호환은 프론트 책임: 아이템 마이그레이션 + 빠진 섹션은
    // 현재 값으로 채워서 완전한 payload를 만든 뒤, Rust의 backup_import로
    // 5개 테이블을 "한 트랜잭션"에 복원한다. (예전 방식은 items는 save_all,
    // 나머지는 각각 따로 fire-and-forget으로 흩어 저장해서, 중간에 앱이
    // 종료되면 반쪽짜리 상태가 남을 수 있었다.)
    const migrated=d.items.map(migrateItem);
    const payload={
      v:5, exported:d.exported||new Date().toISOString(),
      fields:Array.isArray(d.fields)?d.fields:FIELDS,
      presets:Array.isArray(d.presets)?d.presets:PRESETS,
      idKinds:Array.isArray(d.idKinds)?d.idKinds:ID_KINDS,
      settings:(d.settings&&typeof d.settings==='object')?d.settings:SETTINGS,
      items:migrated
    };
    try{ await invoke('backup_import',{payload}); }
    catch(err){ alert('백업 복원 실패 (데이터는 변경되지 않았습니다): '+err); return; }
    // DB 복원이 성공한 뒤에만 메모리 상태를 갈아끼운다
    items=migrated;
    window.__importedFields=payload.fields;
    window.__importedPresets=payload.presets;
    window.__importedIdKinds=payload.idKinds;
    window.__importedSettings=payload.settings;
    reconcileImported(); persist();
    showToast(`백업 ${migrated.length}건을 복원했습니다`);
    return;
  }

  // result.kind === 'Db' — 검증·대기 등록까지만 된 상태. JSON 쪽과 같은
  // 문구·같은 확인 절차를 거치고, 거절하면 대기 등록을 실제로 취소한다.
  if(!confirm(`백업 파일에 업무 ${result.items}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?\n(DB 파일 복원은 재시작할 때 적용됩니다)`)){
    try{ await invoke('cancel_pending_import'); }catch{}
    showToast('복원을 취소했습니다');
    return;
  }
  if(confirm('지금 재시작할까요?')){
    invoke('restart_app');
  }else{
    alert('다음에 앱을 다시 시작하면 복원이 적용됩니다.');
  }
});

/* =========================================================================
   구버전 아이템 마이그레이션 → v5 구조
   who/org/phone(f) → contacts[], mid(f) 제거, title/summary → memo, notice/sr → ids
   ========================================================================= */
function migrateItem(o){
  const it=Object.assign({}, o);
  it.f=Object.assign({}, o.f||{});
  it.contacts=Array.isArray(o.contacts)?o.contacts:[];
  it.ids=Array.isArray(o.ids)?o.ids.slice():[];
  it.subs=Array.isArray(o.subs)?o.subs:[];
  // 메모 승계
  if(it.memo==null) it.memo = o.memo || o.title || '';
  // 관련인 승계
  if(!it.contacts.length && (it.f.who||it.f.org||it.f.phone)){
    it.contacts.push({who:it.f.who||'',org:it.f.org||'',phone:it.f.phone||''});
  }
  delete it.f.who; delete it.f.org; delete it.f.phone;
  // 상위 중간점검 → 세부로 흡수 불가하니 제거(세부 mid만 사용)
  if(it.f.mid){ delete it.f.mid; }
  // notice/sr → ids
  if(it.f.notice){ it.ids.push({kind:'입찰공고번호',val:it.f.notice}); delete it.f.notice; }
  if(it.f.sr){ it.ids.push({kind:'SR번호',val:it.f.sr}); delete it.f.sr; }
  // 식별번호 개수 제한 없음
  if(typeof it.title!=='undefined') delete it.title;
  // F12: 구버전 백업의 누락된 세부 id 보정 (없으면 편집 때마다 al 초기화됨)
  it.subs = it.subs.map(s=>{
    const t=Object.assign({}, s);
    if(t.id==null || t.id==='') t.id = newId();
    if(!t.al || typeof t.al!=='object') t.al = {};
    return t;
  });
  // _lastId 시드: 기존 id보다 항상 크게
  const maxId = Math.max(Number(it.id)||0, ...it.subs.map(s=>Number(s.id)||0));
  if(maxId > _lastId) _lastId = maxId;
  return it;
}

/* =========================================================================
   초기 로드 — SQLite에서 자동 불러오기
   ========================================================================= */
(async()=>{
  try{
    const loaded  = (await STORE.load()).map(migrateItem);
    const pending = items.slice();                     // 로드 대기 중 사용자가 입력한 항목
    items = loaded.concat(pending.filter(p => !loaded.some(l => l.id === p.id)));
    window.items = items;
    LOADED = true;                                     // 이제부터 저장 허용
    reconcileImported();
    if(pending.length) await STORE.saveAll(items);     // 보류됐던 저장 플러시
    setStatus('saved');
    render();
  }catch(e){
    // 로드 실패를 조용히 삼키면 "빈 화면 + 저장도 안 되는" 죽은 앱이 된다.
    // LOADED는 false로 남겨 저장을 계속 차단하되(F1), 무슨 일이 났는지와
    // 복구 경로(JSON·DB파일 불러오기)를 사용자에게 반드시 알린다.
    console.error('initial load failed', e);
    setStatus('error');
    alert('저장된 데이터를 불러오지 못했습니다.\n\n'+e+'\n\n앱은 열려 있지만 데이터 유실 방지를 위해 저장이 차단된 상태입니다.\n[JSON·DB파일 불러오기]로 백업에서 복원하거나, 앱을 다시 시작해보세요.');
  }
  /* 버전 표기 규칙: 매니페스트 "2.2.0"→"v2.2", "2.21.0"→"v2.21"
     (큰 업데이트 +0.1 = 가운데 자리, 사소한 업데이트 +0.01 = 가운데 자리 두번째 숫자) */
  try{ const v=await window.__TAURI__.app.getVersion(); $('appVer').textContent='v'+v.replace(/\.0$/,''); }catch{}
})();
