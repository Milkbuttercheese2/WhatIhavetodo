/* =========================================================================
   렌더 — 보드/완료 카드 재생성 + persist()
   ========================================================================= */
import {S, toggleDone} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, escAttr, showToast, askNotify} from './dom-utils.js';
import {fmtDue} from './datetime.js';
import {placeOf} from './placement.js';
import {textMatch} from './filters.js';
import {recurLabel} from './recur.js';
import {openForm} from './form.js';
import {renderCal} from './calendar.js';

/* 부모(주기 정의)는 보드 밖 — 화면 어디에도 카드로 그리지 않는다 */
const onBoard = it => !it.recur;

let q='', dq='';

function matchesQ(it){ return textMatch(it, q); }

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
  const subs=it.subs||[];
  const memo=(it.memo||'').trim();
  const memoHtml = memo ? esc(memo) : '<span style="color:var(--ink-soft)">(메모 없음)</span>';
  const es=earliestSub(it);
  const progress = subs.length?`<span class="mini-prog">세부 ${subs.filter(s=>s.done).length}/${subs.length}</span>`:'';
  const parent = it.recurId!=null ? S.items.find(x=>x.id===it.recurId) : null;
  const recurTag = it.recurId!=null?`<span class="tag mid" title="${escAttr(parent&&parent.recur?recurLabel(parent.recur):'주기 업무에서 생성됨')}">주기</span>`:'';
  let subLine='';
  if(es){
    const m=es.mid?fmtDue(es.mid):null;
    subLine=`<div class="card-subline">▸ <span class="sub-title">${esc(es.title)}</span>${m?`${alarmDot(es,'mid')}<span class="sub-when ${m.cls==='late'?'late':''}">${esc(m.label)}</span>`:''}</div>`;
  }
  const files=it.files||[];
  const fileLine=files.length?`<div class="card-files">${files.map(p=>{
    const n=String(p).split(/[\\/]/).filter(Boolean).pop()||p;
    return `<span class="file-link" data-fopen="${escAttr(p)}" title="${escAttr('열기: '+p)}">${esc(n)}</span><span class="file-reveal" data-freveal="${escAttr(p)}" title="폴더에서 보기">폴더</span>`;
  }).join('')}</div>`:'';
  return `<div class="card p-${place}${it.done?' done':''}" data-open="${it.id}">
    <div class="card-top">
      <div class="chk ${it.done?'on':''}" data-id="${it.id}"></div>
      <div class="card-body">
        <div class="card-memo">${memoHtml}</div>
        ${subLine}
        <div class="card-meta">${dueTagHtml(it)}${recurTag}${progress}</div>
        ${fileLine}
      </div>
      <button class="del" data-del="${it.id}" title="삭제">×</button>
    </div></div>`;
}
export function render(){
  const cols={inbox:[],today:[],doing:[],planned:[]};
  S.items.filter(onBoard).filter(matchesQ).forEach(it=>{ const p=placeOf(it); if(cols[p])cols[p].push(it); });
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
