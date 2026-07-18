/* =========================================================================
   렌더 — 보드/완료 카드 재생성 + persist()
   ========================================================================= */
import {S, toggleDone} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, escAttr, showToast, askNotify} from './dom-utils.js';
import {fmtDue} from './datetime.js';
import {placeOf, placeMode, ownerOf} from './placement.js';
import {textMatch} from './filters.js';
import {recurLabel} from './recur.js';
import {openForm} from './form.js';
import {renderCal} from './calendar.js';

/* 부모(주기 정의)는 보드 밖 — 화면 어디에도 카드로 그리지 않는다 */
const onBoard = it => !it.recur;

let q='', dq='';

function matchesQ(it){ return textMatch(it, q); }

/* 알람 점 — "울렸는지"만 3단계로 단순화(v2.4.4). 미룸(스누즈) 색 구분은 없앤다.
   ○ 대기(안 울림·빈 점) / ● 울림(시각 지남·빨강) / ● 확인함(팝업에서 [확인]·초록).
   스누즈(al=숫자)도 이미 울린 것이므로 '울림(빨강)'으로 묶는다. 완료 업무·세부는 점 없음. */
function alarmDot(obj,key){
  if(obj.done) return '';
  const iso=key==='due'?(obj.f||{}).due:obj.mid;
  if(!iso) return '';
  const t=new Date(iso).getTime();
  if(isNaN(t)) return '';
  const st=(obj.al||{})[key];
  let cls,tip;
  if(st===true){ cls='ad-done'; tip='알람 확인함'; }              // ● 확인함(초록)
  else if(t<=Date.now()){ cls='ad-ring'; tip='알람 울림'; }        // ● 울림(빨강) — 미확인·스누즈 포함
  else { cls='ad-wait'; tip='알람 대기'; }                         // ○ 대기
  return `<span class="adot ${cls}" title="${escAttr(tip)}"></span>`;
}
/* 카드에 보일 세부 할일: '울린 것(지난 미완료 점검)'을 우선 표시 —
   지나서 울린 점검이 있으면 가장 오래된(먼저 지난) 것을, 없으면 가장 임박한 미래 것을 보여준다. */
function earliestSub(it){
  const now=Date.now();
  const pend=(it.subs||[]).filter(s=>!s.done && s.mid);
  if(!pend.length) return null;
  const past=pend.filter(s=>new Date(s.mid).getTime()<=now).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  if(past[0]) return past[0];   // 울린 것 우선 — 먼저 지난(가장 오래된) 것
  const future=pend.filter(s=>new Date(s.mid).getTime()>now).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  return future[0]||null;
}
/* 카드 겉면: 메모(1줄) · 가장 임박한 세부 할일 · 시각 · 진행/담당 만.
   관련인/식별번호는 카드에서 감추고 팝업에서만 표시. */
/* 시각 pill 공용 빌더 — #마감(due)과 #점검(세부 mid)이 같은 마크업을 쓴다(중복 방지).
   adot는 태그(pill) 밖에 둔다 — '대기'의 투명 배경이 pill 색과 겹치지 않도록. */
function timePill(obj,key,iso,label){
  const m=fmtDue(iso); if(!m) return '';      // F7: 손상 ISO면 렌더 생략
  return `${alarmDot(obj,key)}<span class="tag time ${m.cls}"><span class="k">${label}</span>${esc(m.label)}</span>`;
}
function dueTagHtml(it){ const v=(it.f||{}).due; return v?timePill(it,'due',v,'#마감:'):''; }
export function cardHtml(it,place){
  const subs=it.subs||[];
  const memo=(it.memo||'').trim();
  const memoHtml = memo ? esc(memo) : '<span style="color:var(--ink-soft)">(메모 없음)</span>';
  const es=earliestSub(it);
  const progress = subs.length?`<span class="mini-prog">#세부: ${subs.filter(s=>s.done).length}/${subs.length}</span>`:'';
  const parent = it.recurId!=null ? S.items.find(x=>x.id===it.recurId) : null;
  const recurTag = it.recurId!=null?`<span class="tag mid" title="${escAttr(parent&&parent.recur?recurLabel(parent.recur):'주기 업무에서 생성됨')}">주기</span>`:'';
  /* v2.5.0 담당 배지 — 시간·담당자 모드에서 타인 업무에만 (''=본인은 표시 없음). v2.5.1: #담당: 형식 */
  const ow=ownerOf(it);
  const ownerTag=(placeMode()==='owner'&&ow)?`<span class="tag owner"><span class="k">#담당:</span>${esc(ow)}</span>`:'';
  /* v2.5.1 시각 표시 정책 — 마감보다 앞서는 미완료 세부가 있으면 그 세부의 점검시각만
     보이고 #마감 태그는 감춘다(둘 다 보이던 중복 제거). 앞서는 세부가 없거나 전부
     완료면 #마감만. 시각 칩은 세부 제목 줄이 아니라 메타 줄에 둔다(제목 잘림 방지).
     카드 구성: 메모 1줄 · 세부 1줄 · 시각(#점검 또는 #마감) · 진행상황/담당. */
  const dueT=(it.f||{}).due?new Date(it.f.due).getTime():NaN;
  const esT=es&&es.mid?new Date(es.mid).getTime():NaN;
  const subFirst = !isNaN(esT) && (isNaN(dueT) || esT<dueT);
  const subLine = es?`<div class="card-subline">▸ <span class="sub-title">${esc(es.title)}</span></div>`:'';
  const timeTag = subFirst ? timePill(es,'mid',es.mid,'#점검:') : dueTagHtml(it);
  const timeLine = timeTag?`<div class="card-meta">${timeTag}</div>`:'';
  const metaBits = `${recurTag}${progress}${ownerTag}`;
  const metaLine = metaBits?`<div class="card-meta">${metaBits}</div>`:'';
  // 파일 링크는 카드 앞면에 표시하지 않는다. 파일은 양식 팝업에서 다룬다(form.js addFormFileRow).
  // 카드 구성(v2.5.1, 최대 4줄·각 1줄): 메모 → 세부(있다면) → 시각(#점검 또는 #마감)
  //  → 진행상황·담당. 빈 줄은 아예 그리지 않는다.
  return `<div class="card p-${place}${it.done?' done':''}" data-open="${it.id}">
    <div class="card-top">
      <div class="chk ${it.done?'on':''}" data-id="${it.id}"></div>
      <div class="card-body">
        <div class="card-memo">${memoHtml}</div>
        ${subLine}
        ${timeLine}
        ${metaLine}
      </div>
      <button class="del" data-del="${it.id}" title="삭제">×</button>
    </div></div>`;
}
/* v2.5.0 보드 모드에 맞는 main 표시 — 보드 탭일 때만 placeMode() 쪽을 보인다 */
function syncBoardVisibility(){
  const t=document.querySelector('.tab.on');
  const onTab=!t||t.dataset.view==='board';
  $('view-board').style.display = onTab&&placeMode()==='time' ? 'grid':'none';
  $('view-board5').style.display = onTab&&placeMode()==='owner' ? 'grid':'none';
}
export function render(){
  syncBoardVisibility();
  /* 정렬: 세부 점검·마감시각 레벨 구분 없이, 먼저 도래하는 시각이 위로.
     (미완료 세부 mid + 마감 due 중 가장 이른 시각 기준 오름차순 → 시각 없으면 뒤, 최신 등록 순) */
  const keyTime=(it)=>{
    const ts=(it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid).getTime()).filter(x=>!isNaN(x));
    const d=(it.f||{}).due?new Date(it.f.due).getTime():NaN;
    if(!isNaN(d)) ts.push(d);
    return ts.length?Math.min(...ts):null;
  };
  const sorter=(a,b)=>{
    const at=keyTime(a), bt=keyTime(b);
    if(at!=null&&bt!=null&&at!==bt) return at-bt;
    if(at!=null&&bt==null) return -1;
    if(at==null&&bt!=null) return 1;
    return b.id-a.id;
  };
  if(placeMode()==='owner'){
    /* 시간·담당자 모드(5열) — 필터·정렬은 시간 모드와 동일, 배치만 placeOwner 결과 */
    const cols={inbox:[],metoday:[],othtoday:[],meplan:[],othplan:[]};
    S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
    for(const k of ['inbox','metoday','othtoday','meplan','othplan']){
      const list=cols[k].sort(sorter);
      $('c5-'+k).textContent=list.length;
      $('col5-'+k).innerHTML=list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':(k==='inbox'?'자유 입력이 여기 쌓입니다.':'해당 업무가 없습니다.')}</div>`;
    }
    renderCal(); renderDone();
    return;
  }
  const cols={inbox:[],today:[],doing:[],planned:[]};
  S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
  const EMPTY={inbox:'자유 입력이 여기 쌓입니다.',today:'오늘 마감·점검 건이 없습니다.<br><b>여유 있는 날</b>',doing:'진행 중인 업무가 없습니다.',planned:'예정 건이 없습니다.'};
  for(const k of ['inbox','today','doing','planned']){
    const list=cols[k].sort(sorter);
    $('c-'+k).textContent=list.length;
    $('col-'+k).innerHTML=list.length?list.map(it=>cardHtml(it,k)).join(''):`<div class="empty">${q?'검색 결과가 없습니다.':EMPTY[k]}</div>`;
  }
  renderCal(); renderDone();
}
export function renderDone(){
  const list=S.items.filter(onBoard).filter(it=>it.done).filter(it=>textMatch(it, dq)).sort((a,b)=>(b.doneAt||b.id)-(a.doneAt||a.id));
  $('done-count').textContent=S.items.filter(onBoard).filter(it=>it.done).length;
  $('col-done').innerHTML=list.length?list.map(it=>cardHtml(it,'done')).join(''):`<div class="empty">${dq?'검색 결과가 없습니다.':'완료된 업무가 없습니다.'}</div>`;
}
export async function persist(){ window.items=S.items; await STORE.saveAll(S.items); render(); askNotify(); }

export function initRender(){
  /* 카드 상호작용 */
  document.body.addEventListener('click',e=>{
    /* 파일 링크 클릭 — 카드 열기(data-open)보다 먼저 처리 */
    const fo=e.target.closest('[data-fopen]');
    if(fo){ e.stopPropagation(); invoke('open_file_path',{path:fo.dataset.fopen}).catch(err=>alert('파일을 열 수 없습니다:\n'+fo.dataset.fopen+'\n\n'+err)); return; }
    const fr=e.target.closest('[data-freveal]');
    if(fr){ e.stopPropagation(); invoke('reveal_file_path',{path:fr.dataset.freveal}).catch(err=>alert('폴더를 열 수 없습니다:\n'+err)); return; }
    const chk=e.target.closest('.chk');
    if(chk&&chk.dataset.id){ e.stopPropagation(); const it=S.items.find(x=>x.id==chk.dataset.id);
      if(it){ toggleDone(it); persist(); } return; }
    const del=e.target.closest('.del');
    if(del&&del.dataset.del){ e.stopPropagation(); const id=+del.dataset.del; const idx=S.items.findIndex(x=>x.id==id);
      if(idx>=0){
        const removed=S.items[idx];
        S.items.splice(idx,1); persist();
        showToast('업무를 삭제했습니다',()=>{ S.items.splice(Math.min(idx,S.items.length),0,removed); persist(); });
      } return; }
    const open=e.target.closest('[data-open]');
    if(open){ const it=S.items.find(x=>x.id==open.dataset.open); if(it)openForm(it); return; }
  });
  /* 주기 재렌더 — 편집 중 보호 */
  setInterval(()=>{ const a=document.activeElement;
    if(a&&(a.matches('#search,#done-search,#inp,.dt-date,.dt-time')||a.closest('#formPanel,#presetModal')))return;
    render(); },60000);
  /* 검색 */
  $('search').addEventListener('input',e=>{q=e.target.value.trim().toLowerCase();render();});
  $('done-search').addEventListener('input',e=>{dq=e.target.value.trim().toLowerCase();renderDone();});
}
