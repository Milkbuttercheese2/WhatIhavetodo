/* =========================================================================
   엔트리 — 모듈 와이어링 + 전역 단축키 + 탭 + 시계 + 초기 로드
   규칙: 기능 모듈에는 최상위 실행문을 두지 않는다(리스너·인터벌은 전부 init*()).
   render↔form, render↔calendar 순환 import는 함수 선언만 오가므로 이 규칙이
   지켜지는 동안 안전하다.
   ========================================================================= */
import {S, reconcileCore, migrateItem} from './state.js';
import {STORE} from './store.js';
import {$, initToast} from './dom-utils.js';
import {initDtDelegation} from './datetime.js';
import {initForm, closeForm} from './form.js';
import {initPresets, renderPresets} from './presets.js';
import {initRender, render, renderDone} from './render.js';
import {initCalendar, renderCal} from './calendar.js';
import {initAlarms} from './alarms.js';
import {initBackup, reconcileImported} from './backup.js';
import {initCapture} from './capture-bridge.js';
import {initSettingsMenu} from './settings-menu.js';
import {initRecurBox, runRecurSpawn} from './recur-box.js';
import {makeItem} from './state.js';
import {setPlaceMode, placeMode} from './placement.js';

reconcileCore();
/* 콘솔 디버깅용 전역 미러 (읽기 전용 용도 — 코드는 항상 S를 본다) */
window.items=S.items; window.FIELDS=S.fields; window.PRESETS=S.presets;
window.ID_KINDS=S.idKinds; window.SETTINGS=S.settings;

initToast(); initDtDelegation(); initForm(); initPresets();
initRender(); initCalendar(); initAlarms(); initBackup(); initCapture();
initSettingsMenu(); initRecurBox();
renderPresets();

/* 탭 */
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===t));
  const v=t.dataset.view;
  $('view-board').style.display=v==='board'&&placeMode()==='time'?'grid':'none';
  $('view-board5').style.display=v==='board'&&placeMode()==='owner'?'grid':'none';
  $('strip').style.display=v==='board'?'flex':'none';
  $('view-cal').classList.toggle('on',v==='cal');
  $('view-done').classList.toggle('on',v==='done');
  $('capture').style.display=v==='board'?'block':'none';
  if(v==='cal')renderCal(); if(v==='done')renderDone();
}));
/* '완료 전체 비우기' 제거됨 */

/* 커스텀 타이틀바 (v2.5.1) — decorations:false 메인 창의 최소화·최대화·닫기.
   닫기는 close() → Rust CloseRequested 핸들러가 closeToTray 설정대로 트레이 숨김/종료 결정.
   __TAURI__.window 는 지연 접근(테스트·일반 브라우저에서 죽지 않게). */
{
  const tbWin=()=>window.__TAURI__.window.getCurrentWindow();
  const tbSafe=fn=>()=>{ try{ fn().catch(()=>{}); }catch{} };
  $('tbMin').addEventListener('click', tbSafe(()=>tbWin().minimize()));
  $('tbMax').addEventListener('click', tbSafe(()=>tbWin().toggleMaximize()));
  $('tbClose').addEventListener('click', tbSafe(()=>tbWin().close()));
}

/* 보드 모드 선택 (시간 | 시간·담당자) — settings.boardMode 로 영속.
   헤더 모드 필(v2.5.0)이 산만하다 하여 v2.5.6에서 [설정] 메뉴의 팝업으로 이동. */
document.body.appendChild($('boardModeModal'));   // 어느 탭에서든 뜨도록 body 직속
function syncBoardModeSel(m){ [...$('boardModeModal').querySelectorAll('.bm-opt')].forEach(x=>x.classList.toggle('on', x.dataset.mode===m)); }
function closeBoardModeModal(){ $('boardModeModal').classList.remove('on'); }
$('boardModeBtn').addEventListener('click',()=>{ syncBoardModeSel(S.settings.boardMode==='owner'?'owner':'time'); $('boardModeModal').classList.add('on'); });
$('boardModeClose').addEventListener('click', closeBoardModeModal);
$('boardModeModal').addEventListener('click',e=>{
  const b=e.target.closest('.bm-opt');
  if(b){ const m=b.dataset.mode;
    if((S.settings.boardMode||'time')!==m){ S.settings.boardMode=m; STORE.saveSettings(S.settings); setPlaceMode(m); render(); }
    syncBoardModeSel(m); return;                 // 선택 즉시 적용, 모달은 열어둔다
  }
  if(e.target.id==='boardModeModal') closeBoardModeModal();   // 배경 클릭 닫기
});

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
  if($('boardModeModal').classList.contains('on')){ closeBoardModeModal(); return; }
});

function tickClock(){ const n=new Date();
  $('clock').textContent=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const days=['일','월','화','수','목','금','토']; $('today').textContent=`${n.getFullYear()}. ${n.getMonth()+1}. ${n.getDate()} (${days[n.getDay()]})`; }
setInterval(tickClock,1000); tickClock();
/* 주기 업무: 자정 넘김·장시간 실행 대비 주기적으로 도래분 생성 */
setInterval(()=>{ if(S.loaded) runRecurSpawn(); }, 60000);

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
    /* 보드 모드 복원 (v2.5.0) — 저장된 boardMode 반영 후 아래 render()가 그린다 */
    const bm = S.settings.boardMode==='owner' ? 'owner' : 'time';
    setPlaceMode(bm); syncBoardModeSel(bm);
    /* 캡처 초안 회수(v3.1.0): 지난 세션이 미등록 초안을 남긴 채 꺼졌다면
       (전원 차단 포함) 분류 대기로 자동 등록하고 초안을 비운다. */
    const draft=(S.settings.captureDraft||'').trim();
    let draftItem=null;
    if(draft){
      draftItem=makeItem({memo:draft, staged:true, f:{received:new Date().toISOString()}});
      S.items.push(draftItem);
      S.settings.captureDraft='';
      STORE.saveSettings(S.settings);
    }
    if(pending.length||draftItem) await STORE.saveAll(S.items);   // 보류됐던 저장 플러시
    runRecurSpawn();                                   // 주기 업무: 예정일 도래분 생성(+저장)
    render();
  }catch(e){
    // 로드 실패를 조용히 삼키면 "빈 화면 + 저장도 안 되는" 죽은 앱이 된다.
    // S.loaded는 false로 남겨 저장을 계속 차단하되(F1), 무슨 일이 났는지와
    // 복구 경로(JSON·DB파일 불러오기)를 사용자에게 반드시 알린다.
    console.error('initial load failed', e);
    alert('저장된 데이터를 불러오지 못했습니다.\n\n'+e+'\n\n앱은 열려 있지만 데이터 유실 방지를 위해 저장이 차단된 상태입니다.\n[JSON·DB파일 불러오기]로 백업에서 복원하거나, 앱을 다시 시작해보세요.');
  }
  /* 버전 표기: v3.0.0부터 X.Y.Z semver 그대로 표시 (구 십진수 규칙의 ".0" 절삭 폐지) */
  try{ const v=await window.__TAURI__.app.getVersion(); $('appVer').textContent='v'+v; }catch{}
})();
