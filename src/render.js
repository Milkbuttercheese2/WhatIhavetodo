/* =========================================================================
   렌더 — 보드/완료 카드 재생성 + persist()
   ========================================================================= */
import {S} from './state.js';
import {STORE} from './store.js';
import {$, esc, escAttr, showToast, askNotify} from './dom-utils.js';
import {fmtDue} from './datetime.js';
import {placeOf} from './placement.js';
import {openForm} from './form.js';
import {renderCal} from './calendar.js';

let q='', dq='';

function contactText(it){ return (it.contacts||[]).map(c=>`${c.who} ${c.org} ${c.phone}`).join(' '); }
function idText(it){ return (it.ids||[]).map(x=>`${x.kind} ${x.val}`).join(' '); }
function haystack(it){ return ((it.memo||'')+' '+contactText(it)+' '+idText(it)+' '+(it.subs||[]).map(s=>s.title).join(' ')).toLowerCase(); }
function matchesQ(it){ return !q || haystack(it).includes(q); }

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
export function cardHtml(it,place){
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
  S.items.forEach(it=>{ if(it.done)return; const d=(it.f||{}).due?new Date(it.f.due):null; if(d&&!isNaN(d)&&d<now)late++; });
  $('st-late').textContent=late; $('st-late-wrap').style.display=late?'flex':'none';
}
export function render(){
  const cols={inbox:[],today:[],doing:[],planned:[]};
  S.items.filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
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
export function renderDone(){
  const list=S.items.filter(it=>it.done).filter(it=>!dq||haystack(it).includes(dq)).sort((a,b)=>(b.doneAt||b.id)-(a.doneAt||a.id));
  $('done-count').textContent=S.items.filter(it=>it.done).length;
  $('col-done').innerHTML=list.length?list.map(it=>cardHtml(it,'done')).join(''):`<div class="empty">${dq?'검색 결과가 없습니다.':'완료된 업무가 없습니다.'}</div>`;
}
export async function persist(){ window.items=S.items; await STORE.saveAll(S.items); render(); askNotify(); }

export function initRender(){
  /* 카드 상호작용 */
  document.body.addEventListener('click',e=>{
    const chk=e.target.closest('.chk');
    if(chk&&chk.dataset.id){ e.stopPropagation(); const it=S.items.find(x=>x.id==chk.dataset.id); if(it){it.done=!it.done; it.doneAt=it.done?Date.now():null; persist();} return; }
    const del=e.target.closest('.del');
    if(del&&del.dataset.del){ e.stopPropagation(); const id=+del.dataset.del; const idx=S.items.findIndex(x=>x.id==id);
      if(idx>=0){
        S.items.splice(idx,1); persist(); showToast('업무를 영구 삭제했습니다');
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
