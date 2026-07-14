/* =========================================================================
   자동 배치 규칙
   ========================================================================= */
export function dayBounds(){ const t0=new Date();t0.setHours(0,0,0,0);const t1=new Date(t0);t1.setDate(t1.getDate()+1);return [t0,t1]; }
/* 미완료 세부 점검시각들 (지난 것 포함) */
export function subMids(it){ return (it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid)).filter(d=>!isNaN(d)); }
export function placeOf(it){
  if(it.recur) return 'recur';        // 부모(주기 정의)는 보드 밖
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
  // '진행 중' = 실제로 손을 댄 업무 — 세부를 하나라도 완료했으면 해당.
  // 전부 완료해도 상위 업무를 완료 체크하기 전까지는 마무리만 남은 '진행 중'이다
  // ('예정 · 대기'로 떨어지던 버그 수정 — 예정·대기는 손 안 댄 업무 전용).
  if(subs.length>0 && subs.some(s=>s.done)) return 'doing';
  // 아직 손대지 않았고 내일 이후 점검/마감만 있는 것은 '예정 · 대기'
  return 'planned';
}
export const PLACE_NAME={inbox:'분류 대기',today:'오늘 처리',doing:'진행 중',planned:'예정 · 대기',done:'완료'};
