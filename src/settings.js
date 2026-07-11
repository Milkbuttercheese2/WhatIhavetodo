/* =========================================================================
   설정 창 — ⚙ 헤더 버튼이 여는 모달(일반/알림/단축키/데이터 좌측 탭).
   v2.4: v2.31에서 제거했던 설정(자동 실행·트레이 상주·닫기 동작·빠른 캡처
   단축키)을 되살리고, 흩어져 있던 데이터 버튼을 '데이터' 탭으로 통합하며,
   테마(라이트/다크/시스템)와 알람 소리 토글을 새로 추가한다.
   집 규칙: 이 파일은 호이스팅 function 선언 + 모듈 지역 let 만 가진다 —
   모든 리스너/초기화는 initSettings() 안에서만. 캡처 창(capture-win.js)은
   메인 모듈 그래프와 격리돼 있으므로 절대 이 파일을 import 하지 않는다.
   ========================================================================= */
import {S, DEFAULT_SETTINGS} from './state.js';
import {STORE, invoke} from './store.js';
import {$, showToast} from './dom-utils.js';
import {renderAlarmToggle} from './alarms.js';
import {renderRecurPanel} from './recur-box.js';

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

let recorded=null;   // 단축키 탭에서 방금 레코딩한(아직 저장 안 한) 값
let _mql=null;       // prefers-color-scheme 미디어쿼리 핸들(시스템 테마 추적)

/* ---- 테마 ---- */
/* 순수 함수(단위 테스트 대상) — 'system'이면 OS 선호도로 해석 */
export function resolveTheme(pref){
  return pref==='dark' ? 'dark' : pref==='light' ? 'light' : (systemPrefersDark()?'dark':'light');
}
/* env.js는 matchMedia를 스텁하지 않는다 — 없으면 라이트로 해석(테스트 통과) */
function systemPrefersDark(){
  return typeof window.matchMedia==='function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}
/* 해석된 테마를 <html data-theme>에 반영 — reconcileImported(backup.js)가
   초기 로드·JSON 복원 후 호출하므로 저장된 테마가 양쪽 경로에서 살아난다 */
export function applyTheme(){
  document.documentElement.dataset.theme = resolveTheme((S.settings||{}).theme);
}

/* ---- 단축키 레코더 (f9e3f67에서 복원) ---- */
const MODS=['Control','Alt','Shift','Meta'];
/* KeyboardEvent → 플러그인 단축키 문자열. e.code(W3C) verbatim — global-shortcut
   파서가 그대로 수용. 모디파이어 없는 단일 키는 오발동 위험이라 거부(null). */
function shortcutFromEvent(e){
  if(!e.code||MODS.includes(e.key)) return null;
  const m=[]; if(e.ctrlKey)m.push('Ctrl'); if(e.altKey)m.push('Alt');
  if(e.shiftKey)m.push('Shift'); if(e.metaKey)m.push('Super');
  return m.length ? m.concat(e.code).join('+') : null;
}
/* 표시용: "Ctrl+Alt+KeyM" → "Ctrl+Alt+M", "Digit1" → "1" */
function prettyShortcut(s){
  return String(s||'').replace(/\bKey([A-Z])\b/,'$1').replace(/\bDigit(\d)\b/,'$1');
}

/* ---- 열기/닫기/탭 ---- */
function showTab(name){
  document.querySelectorAll('#setTabs .set-tab').forEach(b=>b.classList.toggle('on',b.dataset.set===name));
  document.querySelectorAll('#settingsBg .set-panel').forEach(p=>p.classList.toggle('on',p.dataset.panel===name));
}
function openSettings(){
  const st=S.settings;
  $('set-autostart').checked=!!st.autostart;
  $('set-automin').checked=st.autostartMinimized!==false;
  $('set-automin').disabled=!st.autostart;
  $('set-tray').checked=st.closeToTray!==false;
  $('set-alarmon').checked=st.alarmOn!==false;
  $('set-alarmsound').checked=st.alarmSound!==false;
  const theme=st.theme||'system';
  document.querySelectorAll('#settingsBg input[name="theme"]').forEach(r=>r.checked=(r.value===theme));
  recorded=null; $('sk-rec').value='';
  $('sk-cur').textContent=prettyShortcut(st.captureShortcut||DEFAULT_SETTINGS.captureShortcut);
  renderRecurPanel();   // 고급 탭 정기함 토글·목록 동기화
  showTab('general');
  $('settingsBg').classList.add('on');
}
export function closeSettings(){ $('settingsBg').classList.remove('on'); }

export function initSettings(){
  $('settingsBtn').addEventListener('click',openSettings);
  $('setClose').addEventListener('click',closeSettings);
  document.querySelectorAll('#setTabs .set-tab').forEach(b=>
    b.addEventListener('click',()=>showTab(b.dataset.set)));

  /* 일반 — 즉시 반영 + 저장 (alarmToggle 패턴) */
  $('set-tray').addEventListener('change',()=>{
    S.settings.closeToTray=$('set-tray').checked; saveSettings();
  });
  $('set-autostart').addEventListener('change', async ()=>{
    const on=$('set-autostart').checked;
    try{
      await invoke('set_autostart',{enabled:on});   // 실패 시 아래 catch에서 롤백
      S.settings.autostart=on; saveSettings();
      $('set-automin').disabled=!on;
    }catch(err){
      console.warn('자동 시작 설정 실패',err);
      $('set-autostart').checked=!on;               // 롤백 — 설정값도 건드리지 않는다
      showToast('자동 시작 설정 실패 — 시스템이 레지스트리 변경을 막았을 수 있습니다');
    }
  });
  $('set-automin').addEventListener('change',()=>{
    S.settings.autostartMinimized=$('set-automin').checked; saveSettings();
  });
  document.querySelectorAll('#settingsBg input[name="theme"]').forEach(r=>
    r.addEventListener('change',()=>{ if(r.checked){ S.settings.theme=r.value; saveSettings(); applyTheme(); } }));

  /* 알림 — alarmOn은 헤더 토글과 같은 상태라 renderAlarmToggle로 동기화 */
  $('set-alarmon').addEventListener('change',()=>{
    S.settings.alarmOn=$('set-alarmon').checked; saveSettings(); renderAlarmToggle();
  });
  $('set-alarmsound').addEventListener('change',()=>{
    S.settings.alarmSound=$('set-alarmsound').checked; saveSettings();
  });

  /* 단축키 레코더 */
  $('sk-rec').addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!e.ctrlKey&&!e.altKey&&!e.shiftKey) return; // 맨 Esc는 모달 닫기(F14)로 버블
    e.preventDefault(); e.stopPropagation();
    const s=shortcutFromEvent(e);
    if(s){ recorded=s; $('sk-rec').value=prettyShortcut(s); }
  });
  $('sk-reset').addEventListener('click',()=>{
    recorded=DEFAULT_SETTINGS.captureShortcut; $('sk-rec').value=prettyShortcut(recorded);
  });
  $('sk-save').addEventListener('click', async ()=>{
    if(!recorded){ showToast('먼저 입력칸을 누르고 원하는 키 조합을 누르세요'); return; }
    try{
      await invoke('set_capture_shortcut',{shortcut:recorded});  // 실패 시 러스트가 이전 키로 롤백
      S.settings.captureShortcut=recorded; saveSettings();
      $('sk-cur').textContent=prettyShortcut(recorded); $('sk-rec').value=''; recorded=null;
      showToast('빠른 캡처 단축키: '+prettyShortcut(S.settings.captureShortcut));
    }catch(err){
      console.warn('단축키 등록 실패',err);
      showToast('단축키 등록 실패 — 기존 단축키를 유지합니다');
    }
  });

  /* 시스템 테마 변경 추적 (테마가 'system'일 때만 재적용) */
  if(typeof window.matchMedia==='function'){
    _mql=window.matchMedia('(prefers-color-scheme: dark)');
    _mql.addEventListener('change',()=>{ if(S.settings.theme==='system') applyTheme(); });
  }
  applyTheme();   // 로드 전 초기 페인트 (진짜 값은 reconcileImported가 재적용)
}
