/* =========================================================================
   캡처 브리지 — 미니 캡처 창(capture.html)과 메인 창 사이의 다리 + 설정 모달.
   캡처 창은 저장하지 않고 이벤트만 보낸다: 여기서 받아 captureMemo()로
   넣으면 F1 로드 게이트·저장 큐·pending-merge(main.js)가 그대로 적용된다.
   주의: __TAURI__.event 는 반드시 함수 안에서 지연 접근 — store.js처럼
   최상위에서 구조분해하면 테스트 하네스(env.js)의 event 스텁보다 먼저 죽는다.
   ========================================================================= */
import {S, DEFAULT_SETTINGS} from './state.js';
import {STORE, invoke} from './store.js';
import {$, showToast} from './dom-utils.js';
import {captureMemo} from './form.js';

const MODS=['Control','Alt','Shift','Meta'];
/* KeyboardEvent → 플러그인 단축키 문자열 ("Ctrl+Alt+Space", "Ctrl+Shift+KeyM").
   e.code(W3C)를 그대로 쓴다 — global-shortcut 파서가 verbatim 수용.
   모디파이어 없는 단일 키는 오발동 위험이라 거부(null). */
export function shortcutFromEvent(e){
  if(!e.code||MODS.includes(e.key)) return null;      // 모디파이어만 눌린 중간 상태
  const m=[]; if(e.ctrlKey)m.push('Ctrl'); if(e.altKey)m.push('Alt');
  if(e.shiftKey)m.push('Shift'); if(e.metaKey)m.push('Super');
  return m.length ? m.concat(e.code).join('+') : null;
}
/* 표시용: "Ctrl+Alt+KeyM" → "Ctrl+Alt+M", "Digit1" → "1" */
export function prettyShortcut(s){
  return String(s||'').replace(/\bKey([A-Z])\b/,'$1').replace(/\bDigit(\d)\b/,'$1');
}

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

let recorded=null;          // 모달에서 방금 레코딩한(아직 저장 안 한) 단축키
let trayNoticePending=false;

function openModal(){
  recorded=null;
  $('ck-rec').value='';
  $('ck-cur').textContent=prettyShortcut(S.settings.captureShortcut||DEFAULT_SETTINGS.captureShortcut);
  $('ck-tray').checked=S.settings.closeToTray!==false;
  $('ck-auto').checked=!!S.settings.autostart;
  $('ck-automin').checked=S.settings.autostartMinimized!==false;
  $('ck-automin').disabled=!$('ck-auto').checked;
  $('capKeyModal').classList.add('on');
  $('ck-rec').focus();
}

export function initCapture(){
  /* 캡처 창에서 온 메모 — captureMemo 가 F1 게이트·pending-merge 를 그대로 태운다 */
  window.__TAURI__.event.listen('wmhh://capture-memo', ev=>{
    const t=(ev.payload||{}).text;
    if(t) captureMemo(t);
  });

  /* X→트레이 전환 알림(Rust) — 첫 회에 한해, 창이 다시 보일 때 안내 토스트.
     숨은 창에서 바로 토스트를 띄워봐야 아무도 못 본다. */
  window.__TAURI__.event.listen('wmhh://hidden-to-tray', ()=>{
    if(S.settings.trayNoticeShown) return;
    trayNoticePending=true;
  });
  window.addEventListener('focus',()=>{
    if(!trayNoticePending) return;
    trayNoticePending=false;
    showToast('닫아도 트레이에서 계속 실행됩니다 (완전 종료는 트레이 우클릭 → 종료)');
    S.settings.trayNoticeShown=true; saveSettings();
  });

  /* ---- 설정 모달 ---- */
  $('capKeyBtn').addEventListener('click',openModal);
  $('ck-close').addEventListener('click',()=>$('capKeyModal').classList.remove('on'));

  $('ck-rec').addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!e.ctrlKey&&!e.altKey&&!e.shiftKey) return; // 맨 Esc는 모달 닫기(F14)로 버블
    e.preventDefault(); e.stopPropagation();
    const s=shortcutFromEvent(e);
    if(s){ recorded=s; $('ck-rec').value=prettyShortcut(s); }
  });
  $('ck-reset').addEventListener('click',()=>{
    recorded=DEFAULT_SETTINGS.captureShortcut;
    $('ck-rec').value=prettyShortcut(recorded);
  });
  $('ck-save').addEventListener('click', async ()=>{
    if(!recorded){ showToast('먼저 입력칸을 누르고 원하는 키 조합을 누르세요'); return; }
    try{
      await invoke('set_capture_shortcut',{shortcut:recorded});   // 실패 시 러스트가 이전 키로 롤백
      S.settings.captureShortcut=recorded; saveSettings();
      showToast('빠른 메모 단축키: '+prettyShortcut(recorded));
      $('capKeyModal').classList.remove('on');
    }catch(err){
      console.warn('단축키 등록 실패',err);
      showToast('단축키 등록 실패 — 기존 단축키를 유지합니다');
    }
  });

  /* 상주 토글 — alarmToggle(alarms.js)과 같은 "즉시 반영 + 저장" 패턴 */
  $('ck-tray').addEventListener('change',()=>{
    S.settings.closeToTray=$('ck-tray').checked; saveSettings();
  });
  $('ck-auto').addEventListener('change', async ()=>{
    const on=$('ck-auto').checked;
    try{
      await invoke('set_autostart',{enabled:on});
      S.settings.autostart=on; saveSettings();
      $('ck-automin').disabled=!on;
    }catch(err){
      console.warn('자동 시작 설정 실패',err);
      $('ck-auto').checked=!on;                        // 롤백 — 설정값도 건드리지 않는다
      showToast('자동 시작 설정 실패 — 시스템이 레지스트리 변경을 막았을 수 있습니다');
    }
  });
  $('ck-automin').addEventListener('change',()=>{
    S.settings.autostartMinimized=$('ck-automin').checked; saveSettings();
  });
}
