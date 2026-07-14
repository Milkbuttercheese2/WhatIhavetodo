/* =========================================================================
   주기 업무(반복) — 다음 회차 계산. 순수 함수만 (상태·DOM 없음).
   recur 모양(아이템 루트의 it.recur, DB items.recur TEXT에 JSON으로 저장):
     {type:'dow',   dow:[0..6], time:'HH:MM'}  — 매주 지정 요일
     {type:'every', days:N,     time:'HH:MM'}  — N일마다
   null/undefined = 반복 없음. 잘못된 모양이면 ''를 돌려 호출부가 무시한다.
   ========================================================================= */

function parseTime(t){
  const m=/^(\d{1,2}):(\d{2})$/.exec(String(t||'').trim());
  if(!m) return null;
  const hh=+m[1], mm=+m[2];
  if(hh>23||mm>59) return null;
  return [hh,mm];
}

/* 유효한 recur 객체인지 (양식 저장·완료 재장전 공용 가드) */
export function isValidRecur(r){
  if(!r||typeof r!=='object') return false;
  if(!parseTime(r.time)) return false;
  if(r.type==='dow') return Array.isArray(r.dow) && r.dow.some(d=>d>=0&&d<=6);
  if(r.type==='every') return Number.isFinite(Number(r.days)) && Number(r.days)>=1;
  return false;
}

/* `from` 이후(초과)의 가장 가까운 회차를 ISO 문자열로. 무효면 ''.
   - dow: from 당일부터 7일 안에서 요일·시각이 맞고 from보다 뒤인 첫 시점
   - every: from 날짜 기준 N일 뒤 같은 시각 (완료 시점 기준으로 밀려가는 앵커) */
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
  const n=Math.max(1,Math.floor(Number(recur.days)));
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate()+n,hh,mm,0,0);
  return d.toISOString();
}

/* 사람이 읽는 요약 (카드 툴팁·양식 힌트용) */
export const DOW_KO=['일','월','화','수','목','금','토'];
export function recurLabel(r){
  if(!isValidRecur(r)) return '';
  if(r.type==='dow') return `매주 ${r.dow.filter(d=>d>=0&&d<=6).sort().map(d=>DOW_KO[d]).join('·')} ${r.time}`;
  return `매 ${Math.max(1,Math.floor(Number(r.days)))}일 ${r.time}`;
}
