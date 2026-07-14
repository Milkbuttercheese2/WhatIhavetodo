/* =========================================================================
   날짜/시간 유틸 — 분리 입력 파서 + 표시 포맷
   날짜: YYYY/MM/DD, YYYY-MM-DD, YYYYMMDD, YYYY.MM.DD 등
   시간: HH:MM, HHMM, HH (분 생략 시 00), 0~24시, 분 자유(0~59)
   ========================================================================= */
import {escAttr} from './dom-utils.js';

/* F4: 존재하지 않는 날짜(2/31 등) 거부 — 생성 후 왕복 검증 */
export function validDate(y,m,da){
  if(!(m>=1&&m<=12&&da>=1&&da<=31)) return false;
  const t=new Date(y,m-1,da);
  return t.getFullYear()===y && t.getMonth()===m-1 && t.getDate()===da;
}
export function parseDateStr(s){
  if(!s) return null;
  const d=String(s).replace(/[^0-9]/g,'');
  if(d.length===8){ const y=+d.slice(0,4),m=+d.slice(4,6),da=+d.slice(6,8);
    if(validDate(y,m,da)) return {y,m,d:da}; }
  if(d.length===6){ const y=2000+ +d.slice(0,2),m=+d.slice(2,4),da=+d.slice(4,6);
    if(validDate(y,m,da)) return {y,m,d:da}; }
  return null;
}
export function parseTimeStr(s){
  if(s===''||s==null) return null;
  const t=s.replace(/[^0-9]/g,'');
  if(t==='') return null;   // F3: 숫자 없는 오입력("abc" 등)을 00:00으로 삼키지 않는다
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
export const DEFAULT_TIME_DUE  = {hh:18, mm:0};   // 마감·중간점검
export const DEFAULT_TIME_ZERO = {hh:0,  mm:0};   // 접수시각 등

/* F3: 반환 3종 —  '' = 미입력(정상),  null = 오입력(저장 차단),  ISO = 정상 */
export function combineDT(dateStr,timeStr,def){
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
export function isoToDateStr(iso){ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; }
export function isoToTimeStr(iso){ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
/* 세부 점검시각 기본값: 오늘 18:00 */

export const DOW=['일','월','화','수','목','금','토'];
export function fmtT(iso){ if(!iso)return null; const d=new Date(iso); if(isNaN(d))return null;
  return `${d.getMonth()+1}/${d.getDate()}(${DOW[d.getDay()]}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
export function fmtDue(iso){ if(!iso)return null; const d=new Date(iso); if(isNaN(d))return null;   // F7: 손상 ISO 방어
  const now=new Date(); const m=Math.round((d-now)/60000);
  // '마감 지남' 강조는 표기하지 않음(사용자 요청). 임박(2시간 내)만 남은 시간 안내.
  let cls='',note=''; if(m>=0&&m<=60){cls='soon';note=` ${m}분후`;} else if(m>60&&m<=120){cls='soon';note=` ${Math.round(m/60)}시간후`;}
  const lbl=fmtT(iso); if(lbl===null) return null;
  return {label:lbl+note,cls}; }

/* 분리 날짜/시간 입력 위젯 HTML */
/* 날짜/시간 입력 내부 마크업 (텍스트 직접입력 + 캘린더 선택 + 요일 표시) */
export function dtInner(dateStr,timeStr){
  return `<input type="text" class="dt-date" placeholder="YYYY/MM/DD" maxlength="10" value="${escAttr(dateStr)}">
    <button type="button" class="dt-pick" title="캘린더에서 선택">📅</button>
    <input type="date" class="dt-native" tabindex="-1" aria-hidden="true">
    <span class="dt-dow"></span>
    <input type="text" class="dt-time" placeholder="HH:MM" maxlength="5" title="비워두면 기본 시각이 채워집니다 (마감·점검 18:00)" value="${escAttr(timeStr)}">`;
}
export function dtInputHtml(cls, iso, dataAttr){
  return `<span class="dt-inp ${cls}" ${dataAttr}>${dtInner(isoToDateStr(iso), isoToTimeStr(iso))}</span>`;
}
/* 요일 갱신 */
export function refreshDow(span){
  const dw=span.querySelector('.dt-dow'); if(!dw)return;
  const dp=parseDateStr(span.querySelector('.dt-date').value);
  dw.textContent = dp ? `(${DOW[new Date(dp.y,dp.m-1,dp.d).getDay()]})` : '';
}
export function readDtInput(spanEl){
  const dd=spanEl.querySelector('.dt-date').value;
  const tt=spanEl.querySelector('.dt-time').value;
  // 접수시각은 00:00, 그 외(마감·중간점검)는 18:00을 기본값으로
  const isReceived = spanEl.dataset.fkey==='received';
  return combineDT(dd,tt, isReceived?DEFAULT_TIME_ZERO:DEFAULT_TIME_DUE);
}
/* 오입력 칸에 빨간 테두리. 포커스 중에는 판정 유예(타이핑 중 오탐 방지) */
export function markDtValidity(span){
  if(!span) return true;
  if(span.contains(document.activeElement)) return true;
  const bad = readDtInput(span)===null;
  span.classList.toggle('dt-bad', bad);
  return !bad;
}
export function validateAllDt(root){
  let ok=true;
  root.querySelectorAll('.dt-inp').forEach(sp=>{ if(!markDtValidity(sp)) ok=false; });
  return ok;
}

/* dt 위젯 공용 이벤트 위임 (문서 전체) — main.js가 1회 호출 */
export function initDtDelegation(){
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
}
