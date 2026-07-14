/* =========================================================================
   Everything(voidtools) 연동 — 보드 검색어로 로컬 파일명 동시검색.
   전제: 사용자 PC에 Everything이 실행 중이고 HTTP 서버 옵션(기본 꺼짐)이
   켜져 있을 때만 동작한다. 미실행이면 결과 스트립이 아예 나타나지 않고
   (무침습), 연결 실패 후에는 2분간 재시도하지 않아 타이핑을 방해하지 않는다.
   파일 열기/폴더 열기 클릭은 render.js의 body 위임 핸들러(data-fopen/
   data-freveal)가 공용 처리한다.
   ========================================================================= */
import {S} from './state.js';
import {invoke} from './store.js';
import {$, esc, escAttr} from './dom-utils.js';

let timer=null;
let port=null;            // 직전에 응답한 포트 기억 (다음 검색은 이 포트만)
let downUntil=0;          // 연결 실패 시 이 시각(ms)까지 재시도 억제
const PORTS=[80,8080];    // settings.everythingPort 미지정 시 순서대로 시도

function candidates(){
  const p=Number((S.settings||{}).everythingPort);
  if(p) return [p];
  return port ? [port] : PORTS;
}
function hide(){ const w=$('ev-results'); w.style.display='none'; w.innerHTML=''; }

async function run(q){
  if(S.settings.everythingQuickSearch===false){ hide(); return; }   // 설정 메뉴 토글
  if(Date.now()<downUntil) return;
  let body=null;
  for(const p of candidates()){
    try{ body=await invoke('everything_search',{query:q,port:p,count:20}); port=p; break; }
    catch{ /* 다음 후보 포트 */ }
  }
  if(body==null){ downUntil=Date.now()+120e3; port=null; hide(); return; }
  if($('search').value.trim()!==q) return;   // 응답 대기 중 검색어가 바뀜 → 버림
  let d; try{ d=JSON.parse(body); }catch{ hide(); return; }
  const rs=Array.isArray(d.results)?d.results:[];
  if(!rs.length){ hide(); return; }
  const w=$('ev-results');
  w.innerHTML=`<span class="ev-head">파일 (Everything) ${Number(d.totalResults)||rs.length}건</span>`
    + rs.map(r=>{
        const name=r.name||'';
        const full=(r.path?r.path+'\\':'')+name;
        const folder=r.type==='folder';
        return `<span class="ev-item" data-fopen="${escAttr(full)}" title="${escAttr('열기: '+full)}">${esc(name)}</span>`;
      }).join('');
  w.style.display='flex';
}

export function initEverything(){
  $('search').addEventListener('input',e=>{
    const q=e.target.value.trim();
    clearTimeout(timer);
    if(!q){ hide(); return; }
    timer=setTimeout(()=>run(q),300);
  });
}
