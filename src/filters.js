/* =========================================================================
   필터 — 아이템 검색 술어(predicate)의 단일 출처.
   보드 검색·완료 검색이 공유하고, 향후 '저장 필터' 뷰가 이 위에 얹힌다.
   순수 함수만 둔다(상태·DOM 없음) — 검색어(q/dq)는 호출부가 보관.
   ========================================================================= */
/* 연락처는 저장값(하이픈 포함)과 숫자만 버전을 함께 넣는다 —
   010-1234-5678로 저장돼도 01012345678 검색이 걸리게(v2.5.1).
   필드 누락 시 'undefined' 문자열이 haystack에 새지 않게 전부 ||'' 가드. */
function contactText(it){ return (it.contacts||[]).map(c=>`${c.who||''} ${c.org||''} ${c.phone||''} ${String(c.phone||'').replace(/[^0-9]/g,'')}`).join(' '); }
function idText(it){ return (it.ids||[]).map(x=>`${x.kind||''} ${x.val||''}`).join(' '); }
/* 링크된 파일은 파일명(경로 마지막 조각)으로 검색 — 폴더 경로까지 걸리면 잡음 */
function fileText(it){ return (it.files||[]).map(p=>String(p).split(/[\\/]/).filter(Boolean).pop()||'').join(' '); }

/* 카드 전 텍스트를 소문자 한 덩어리로 — includes 검색용.
   v2.5.0: 담당자(아이템·세부 owner) 포함 — 이름 검색으로 맡긴 업무를 찾는다 */
export function haystack(it){
  return ((it.memo||'')+' '+(it.owner||'')+' '+contactText(it)+' '+idText(it)+' '+(it.subs||[]).map(s=>`${s.title||''} ${s.owner||''}`).join(' ')+' '+fileText(it)).toLowerCase();
}

/* 이미 소문자로 정규화된 검색어(needle)와의 부분일치. 빈 검색어는 전체 통과. */
export function textMatch(it, needle){ return !needle || haystack(it).includes(needle); }
