/* =========================================================================
   자동 배치 규칙
   ========================================================================= */
/* v2.5.0 보드 모드 — 'time'(기존 4열) | 'owner'(시간·담당자 5열). main.js·토글이 설정 */
let MODE='time';
export function setPlaceMode(m){ MODE = m==='owner' ? 'owner' : 'time'; }
export function placeMode(){ return MODE; }
export function dayBounds(){ const t0=new Date();t0.setHours(0,0,0,0);const t1=new Date(t0);t1.setDate(t1.getDate()+1);return [t0,t1]; }
/* 미완료 세부 점검시각들 (지난 것 포함) */
export function subMids(it){ return (it.subs||[]).filter(s=>!s.done&&s.mid).map(s=>new Date(s.mid)).filter(d=>!isNaN(d)); }
/* 담당자 판정 — 유효한 점검시각이 있는 가장 이른 미완료 세부의 owner → 없으면 '' (=본인).
   담당자는 세부할일 전용(v2.5.2) — it.owner는 레거시 보존값(데이터 호환용, UI·판정 제외) */
export function ownerOf(it){
  const pend=(it.subs||[]).filter(s=>!s.done&&s.mid&&!isNaN(new Date(s.mid))).sort((a,b)=>new Date(a.mid)-new Date(b.mid));
  return (pend[0]&&pend[0].owner) || '';
}
/* 시각이 하나도 지정되지 않은 업무 — 유효한 마감도 없고, 세부 점검시각도 (완료분 포함)
   전혀 없다. v2.5.18: 이런 업무는 '예정 · 대기'가 아니라 '분류 대기'로 보낸다 —
   언제 할지 정하지 않았다는 건 아직 분류가 끝나지 않은 것이기 때문.
   손상된 ISO 는 시각 없음으로 친다(F7 계열 가드와 동일 방향). */
export function noTimeSet(it){
  const f=it.f||{}, due=f.due?new Date(f.due):null;
  if(due&&!isNaN(due)) return false;
  return (it.subs||[]).every(s=>!s.mid||isNaN(new Date(s.mid)));
}
/* 시간·담당자 모드 배치(5단계) — 4단계와 달리 '진행 중' 칸이 없어 판정이 두 단계다.
     ① 시각이 하나도 안 정해짐 → 분류 대기
     ② 그 외 → 오늘/오늘 외 × 본인/타인 (2×2)
   기준 시각 = 미완료 세부 검토일 ∪ 유효 마감 중 가장 이른 것. 내일 자정 전이면
   '오늘'(지난 시각 포함), 아니면 '오늘 외'. 본인/타인은 ownerOf 로 가른다.
   (v2.5.18 전에는 시각이 없어도 '오늘 외'로 보냈다 — 이제 ①이 먼저 걸러낸다.) */
function placeOwner(it){
  if(noTimeSet(it)) return 'inbox';   // v2.5.18: 시각 미지정은 분류 대기 (시간 모드와 동일)
  const f=it.f||{}, [,t1]=dayBounds();
  const ts=subMids(it).map(d=>d.getTime());
  const due=f.due?new Date(f.due):null;
  if(due&&!isNaN(due)) ts.push(due.getTime());
  const ref=ts.length?Math.min(...ts):null;
  const isToday = ref!=null && ref<t1.getTime();
  return (ownerOf(it)?'oth':'me')+(isToday?'today':'plan');
}
export function placeOf(it){
  if(it.recur) return 'recur';        // 부모(주기 정의)는 보드 밖
  if(it.done) return 'done';
  if(it.staged) return 'inbox';
  if(MODE==='owner') return placeOwner(it);
  /* v2.5.18 판정 순서(4단계) — ② → ③ → ① → ④:
       ② 마감일·검토일이 오늘(지났거나 오늘)  → 오늘 처리
       ③ 할 일을 하나라도 완료했는가          → 진행 중
       ① 마감일·검토일이 하나도 안 정해졌는가 → 분류 대기
       ④ 그 외                                → 예정 · 대기
     ①을 ③ 뒤에 두는 이유: 이미 손댄 업무(세부를 하나라도 완료)는 시각이 없더라도
     '진행 중'을 유지한다 — 진행하던 일이 미분류 칸으로 역행하지 않게. */
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
  // ① 시각을 하나도 안 정한 업무는 '분류 대기' — 언제 할지 정하는 것이 곧 분류다.
  //    (손댄 업무는 위 ③에서 이미 걸러졌다.)
  if(noTimeSet(it)) return 'inbox';
  // ④ 아직 손대지 않았고 내일 이후 점검/마감만 있는 것은 '예정 · 대기'
  return 'planned';
}
export const PLACE_NAME={inbox:'분류 대기',today:'오늘 처리',doing:'진행 중',planned:'예정 · 대기',done:'완료',
  metoday:'본인 진행 · 오늘',othtoday:'타인 진행 · 오늘',meplan:'본인 진행 · 오늘 외',othplan:'타인 진행 · 오늘 외'};
