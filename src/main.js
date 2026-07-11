/* =========================================================================
   엔트리 — 모듈 와이어링 + 전역 단축키 + 탭 + 시계 + 초기 로드
   규칙: 기능 모듈에는 최상위 실행문을 두지 않는다(리스너·인터벌은 전부 init*()).
   render↔form, render↔calendar 순환 import는 함수 선언만 오가므로 이 규칙이
   지켜지는 동안 안전하다.
   ========================================================================= */
import {S, reconcileCore, migrateItem} from './state.js';
import {STORE, setStatus} from './store.js';
import {$, initToast} from './dom-utils.js';
import {initDtDelegation} from './datetime.js';
import {initForm, closeForm} from './form.js';
import {initPresets, renderPresets} from './presets.js';
import {initRender, render, renderDone} from './render.js';
import {initCalendar, renderCal} from './calendar.js';
import {initAlarms} from './alarms.js';
import {initBackup, reconcileImported} from './backup.js';
import {initCapture} from './capture-bridge.js';

reconcileCore();
/* 콘솔 디버깅용 전역 미러 (읽기 전용 용도 — 코드는 항상 S를 본다) */
window.items=S.items; window.FIELDS=S.fields; window.PRESETS=S.presets;
window.ID_KINDS=S.idKinds; window.SETTINGS=S.settings;

initToast(); initDtDelegation(); initForm(); initPresets();
initRender(); initCalendar(); initAlarms(); initBackup(); initCapture();
renderPresets();

/* 탭 */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
  const v=t.dataset.view;
  $('view-board').style.display=v==='board'?'grid':'none';
  $('strip').style.display=v==='board'?'flex':'none';
  $('view-cal').classList.toggle('on',v==='cal');
  $('view-done').classList.toggle('on',v==='done');
  $('capture').style.display=v==='board'?'block':'none';
  if(v==='cal')renderCal(); if(v==='done')renderDone();
}));
/* '완료 전체 비우기' 제거됨 */

/* Ctrl+S: 양식 팝업 열려 있으면 저장, 아니면 JSON 백업 */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey) && (e.key==='s'||e.key==='S')){
    e.preventDefault();
    if($('formPanel').classList.contains('on')){ $('fm-save').click(); }
    else if($('presetModal').classList.contains('on')){ $('np-save').click(); }
    else { $('bkExp').click(); }
  }
});
/* F14: ESC 로 팝업 닫기. 배경 클릭 닫기는 드래그 선택 시 오작동하므로 의도적으로 제외.
   알람 모달은 명시적 확인이 필요하므로 대상에서 제외. */
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if($('formPanel').classList.contains('on')){ closeForm(); return; }
  if($('presetModal').classList.contains('on')){ $('presetModal').classList.remove('on'); return; }
  if($('capKeyModal').classList.contains('on')){ $('capKeyModal').classList.remove('on'); return; }
});

function tickClock(){ const n=new Date();
  $('clock').textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const days=['일','월','화','수','목','금','토']; $('today').textContent=`${n.getFullYear()}. ${n.getMonth()+1}. ${n.getDate()} (${days[n.getDay()]})`; }
setInterval(tickClock,1000); tickClock();

/* =========================================================================
   초기 로드 — SQLite에서 자동 불러오기
   ========================================================================= */
(async()=>{
  try{
    const loaded  = (await STORE.load()).map(migrateItem);
    const pending = S.items.slice();                   // 로드 대기 중 사용자가 입력한 항목
    S.items = loaded.concat(pending.filter(p => !loaded.some(l => l.id === p.id)));
    window.items = S.items;
    S.loaded = true;                                   // F1: 이제부터 저장 허용
    reconcileImported();
    if(pending.length) await STORE.saveAll(S.items);   // 보류됐던 저장 플러시
    setStatus('saved');
    render();
  }catch(e){
    // 로드 실패를 조용히 삼키면 "빈 화면 + 저장도 안 되는" 죽은 앱이 된다.
    // S.loaded는 false로 남겨 저장을 계속 차단하되(F1), 무슨 일이 났는지와
    // 복구 경로(JSON·DB파일 불러오기)를 사용자에게 반드시 알린다.
    console.error('initial load failed', e);
    setStatus('error');
    alert('저장된 데이터를 불러오지 못했습니다.\n\n'+e+'\n\n앱은 열려 있지만 데이터 유실 방지를 위해 저장이 차단된 상태입니다.\n[JSON·DB파일 불러오기]로 백업에서 복원하거나, 앱을 다시 시작해보세요.');
  }
  /* 버전 표기 규칙: 매니페스트 "2.2.0"→"v2.2", "2.21.0"→"v2.21"
     (큰 업데이트 +0.1 = 가운데 자리, 사소한 업데이트 +0.01 = 가운데 자리 두번째 숫자) */
  try{ const v=await window.__TAURI__.app.getVersion(); $('appVer').textContent='v'+v.replace(/\.0$/,''); }catch{}
})();
