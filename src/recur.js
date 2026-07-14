/* =========================================================================
   주기 업무(반복) — 부모-자식 생성기 (정규화 모델).
   - 부모(주기 정의): it.recur 가 있는 아이템. 보드 밖에 살며 공통정보(메모)만
     최소로 담는다. recur 모양(items.recur TEXT에 JSON으로 저장):
       {type:'dow',     dow:[0..6], time:'HH:MM', next?:ISO, paused?:bool}  — 매주 지정 요일
       {type:'every',   days:N,     time:'HH:MM', next?:ISO, paused?:bool}  — N일마다
       {type:'monthly', day:1..31,  time:'HH:MM', next?:ISO, paused?:bool}  — 매월 지정일
       (매월: 그 달에 해당 일이 없으면 말일로 맞춤 — 예: 31일 → 2월은 28/29일)
     next = 다음에 생성할 회차의 ISO(생성기가 전진시킴), paused = 일시정지.
   - 자식(생성된 업무): it.recurId = 부모.id 인 일반 아이템. 마감(f.due)=회차 시각.
     부모 → 자식: items.filter(x=>x.recurId===부모.id). 자식 → 부모: it.recurId.
   순수 계산부(nextOccurrence 등)는 상태·DOM 없음. spawnDueOccurrences만 makeItem을
   빌려 자식 아이템을 만든다(상태 변경은 호출부가 persist).
   ========================================================================= */
import {makeItem} from './state.js';

function parseTime(t){
  const m=/^(\d{1,2}):(\d{2})$/.exec(String(t||'').trim());
  if(!m) return null;
  const hh=+m[1], mm=+m[2];
  if(hh>23||mm>59) return null;
  return [hh,mm];
}

/* 그 달의 마지막 날 (31일 지정이 2월 등에서 말일로 맞춰지도록) */
function clampDay(y, mo, day){ const last=new Date(y, mo+1, 0).getDate(); return Math.min(Math.max(1,day), last); }

/* 유효한 recur 객체인지 (정의 저장·생성 공용 가드) */
export function isValidRecur(r){
  if(!r||typeof r!=='object') return false;
  if(!parseTime(r.time)) return false;
  if(r.type==='dow') return Array.isArray(r.dow) && r.dow.some(d=>d>=0&&d<=6);
  if(r.type==='every') return Number.isFinite(Number(r.days)) && Number(r.days)>=1;
  if(r.type==='monthly') return Number.isFinite(Number(r.day)) && Number(r.day)>=1 && Number(r.day)<=31;
  return false;
}

/* `from` 이후(초과)의 가장 가까운 회차를 ISO 문자열로. 무효면 ''.
   - dow: from 당일부터 7일 안에서 요일·시각이 맞고 from보다 뒤인 첫 시점
   - every: from 날짜 기준 N일 뒤 같은 시각 */
export function nextOccurrence(recur, from){
  if(!isValidRecur(recur)) return '';
  const [hh,mm]=parseTime(recur.time);
  const base=from?new Date(from):new Date();
  if(isNaN(base)) return '';
  if(recur.type==='dow'){
    const set=recur.dow.filter(d=>d>=0&&d<=6);
    for(let i=0;i<8;i++){
      const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+i,hh,mm,0,0);
      if(d>base && set.includes(d.getDay())) return d.toISOString();
    }
    return '';
  }
  if(recur.type==='monthly'){
    let y=base.getFullYear(), mo=base.getMonth();
    for(let i=0;i<13;i++){
      const d=new Date(y,mo,clampDay(y,mo,Number(recur.day)),hh,mm,0,0);
      if(d>base) return d.toISOString();
      mo++; if(mo>11){mo=0;y++;}
    }
    return '';
  }
  const n=Math.max(1,Math.floor(Number(recur.days)));
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+n,hh,mm,0,0);
  return d.toISOString();
}

/* 정의 직후 첫 회차: 오늘 지정 시각이 아직 안 지났고 조건에 맞으면 오늘, 아니면 다음.
   (dow는 오늘 요일이 포함될 때만 오늘 허용. every는 오늘 시각 전이면 오늘부터 시작.) */
export function initialNext(recur, now=new Date()){
  if(!isValidRecur(recur)) return '';
  const [hh,mm]=parseTime(recur.time);
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),hh,mm,0,0);
  if(recur.type==='dow'){
    if(today>now && recur.dow.filter(d=>d>=0&&d<=6).includes(today.getDay())) return today.toISOString();
    return nextOccurrence(recur, now);
  }
  if(recur.type==='monthly') return nextOccurrence(recur, now);   // 이달 지정일이 남았으면 그날, 아니면 다음달
  if(today>now) return today.toISOString();                        // every: 오늘 시각 전이면 오늘부터
  return nextOccurrence(recur, now);
}

/* 내일 00:00 — '오늘까지 도래한' 회차를 포함해 생성하기 위한 경계 */
function endOfToday(now){ const t=new Date(now); t.setHours(0,0,0,0); t.setDate(t.getDate()+1); return t; }

/* 부모 정의에서 예정일이 도래한 자식 업무들을 생성한다.
   각 부모의 recur.next 가 오늘(포함) 이전이면 자식을 만들고 next 를 전진.
   14일보다 오래된 밀린 회차는 생성하지 않고 건너뛴다(장기 미실행 시 폭주 방지) —
   완료되지 않은 옛 알림을 수백 개 만들지 않기 위함. 반환 = 생성된 자식 배열
   (호출부가 S.items에 push + persist). 부모의 recur.next 는 이 함수가 갱신한다. */
export function spawnDueOccurrences(items, now=new Date()){
  const spawned=[];
  const limit=endOfToday(now);
  const floor=new Date(now); floor.setDate(floor.getDate()-14);   // 14일 이전 밀린 회차는 스킵
  for(const p of items){
    if(!p || !isValidRecur(p.recur) || p.recur.paused) continue;
    if(!p.recur.next){ p.recur.next = initialNext(p.recur, now) || ''; }
    let guard=0;
    // 너무 오래된 회차는 생성 없이 건너뛰어 next 를 최근으로 당긴다
    while(p.recur.next && new Date(p.recur.next) < floor && guard++<2000){
      const nx=nextOccurrence(p.recur, new Date(p.recur.next));
      if(!nx || nx===p.recur.next){ p.recur.next=''; break; }
      p.recur.next=nx;
    }
    // 최근 밀린 회차 ~ 오늘까지 실제 생성
    while(p.recur.next && new Date(p.recur.next) < limit && guard++<2000){
      const occ=p.recur.next;
      spawned.push(makeChild(p, occ));
      const nx=nextOccurrence(p.recur, new Date(occ));
      if(!nx || nx===occ){ p.recur.next=''; break; }
      p.recur.next=nx;
    }
  }
  return spawned;
}

/* 자식 아이템: 부모의 공통정보(메모)만 스냅샷으로 받고, 나머지 세부는 비워
   사용자가 회차별로 채우게 한다. recurId 로 부모를 가리킨다(정규화 링크). */
function makeChild(parent, occIso){
  return makeItem({
    memo: parent.memo||'',
    staged:false,
    recurId: parent.id,
    f:{ received:new Date().toISOString(), due:occIso },
  });
}

/* 사람이 읽는 요약 (관리 목록·카드 배지용) */
export const DOW_KO=['일','월','화','수','목','금','토'];
export function recurLabel(r){
  if(!isValidRecur(r)) return '';
  if(r.type==='dow') return `매주 ${r.dow.filter(d=>d>=0&&d<=6).sort((a,b)=>a-b).map(d=>DOW_KO[d]).join('·')} ${r.time}`;
  if(r.type==='monthly') return `매월 ${Number(r.day)}일 ${r.time}`;
  return `매 ${Math.max(1,Math.floor(Number(r.days)))}일 ${r.time}`;
}
