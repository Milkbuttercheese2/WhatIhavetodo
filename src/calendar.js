/* =========================================================================
   캘린더
   ========================================================================= */
import {S} from './state.js';
import {$, esc, escAttr} from './dom-utils.js';
import {DOW} from './datetime.js';
import {placeOf} from './placement.js';
import {cardHtml} from './render.js';

let calY=new Date().getFullYear(), calM=new Date().getMonth(), calSel=null;

/* 캘린더 이벤트: 세부 할일 우선. 세부 할일이 없으면 그 업무의 메모를 마감일에 표기.
   접수·마감 자체는 별도 표시하지 않음. */
function dayEvents(){
  const map={};
  const push=(iso,payload)=>{ if(!iso)return; const d=new Date(iso); if(isNaN(d))return;
    const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; (map[key]=map[key]||[]).push(Object.assign({iso},payload)); };
  S.items.forEach(it=>{
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
export function renderCal(){
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

export function initCalendar(){
  $('cal-prev').addEventListener('click',()=>{calM--;if(calM<0){calM=11;calY--;}calSel=null;renderCal();});
  $('cal-next').addEventListener('click',()=>{calM++;if(calM>11){calM=0;calY++;}calSel=null;renderCal();});
  $('cal-today').addEventListener('click',()=>{const n=new Date();calY=n.getFullYear();calM=n.getMonth();calSel=null;renderCal();});
  $('cal-grid').addEventListener('click',e=>{
    const cell=e.target.closest('.cal-day'); if(!cell)return; calSel=cell.dataset.key; renderCal();
    const evs=(dayEvents()[calSel]||[]); const dt=$('cal-detail'); if(!evs.length){dt.classList.remove('on');return;}
    const [y,m,dd]=calSel.split('-').map(Number); const dObj=new Date(y,m,dd);
    $('cal-detail-title').textContent=`${y}년 ${m+1}월 ${dd}일 (${DOW[dObj.getDay()]}) — ${evs.length}건`;
    const seen=new Set(); $('cal-detail-cards').innerHTML=evs.filter(ev=>{if(seen.has(ev.it.id))return false;seen.add(ev.it.id);return true;}).map(ev=>cardHtml(ev.it,placeOf(ev.it))).join('');
    dt.classList.add('on');
  });
}
