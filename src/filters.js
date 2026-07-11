/* =========================================================================
   필터 — 아이템 검색 술어(predicate)의 단일 출처.
   보드 검색·완료 검색이 공유하고, 향후 '저장 필터' 뷰가 이 위에 얹힌다.
   순수 함수만 둔다(상태·DOM 없음) — 검색어(q/dq)는 호출부가 보관.
   ========================================================================= */
function contactText(it){ return (it.contacts||[]).map(c=>`${c.who} ${c.org} ${c.phone}`).join(' '); }
function idText(it){ return (it.ids||[]).map(x=>`${x.kind} ${x.val}`).join(' '); }

/* 카드 전 텍스트를 소문자 한 덩어리로 — includes 검색용 */
export function haystack(it){
  return ((it.memo||'')+' '+contactText(it)+' '+idText(it)+' '+(it.subs||[]).map(s=>s.title).join(' ')).toLowerCase();
}

/* 이미 소문자로 정규화된 검색어(needle)와의 부분일치. 빈 검색어는 전체 통과. */
export function textMatch(it, needle){ return !needle || haystack(it).includes(needle); }
