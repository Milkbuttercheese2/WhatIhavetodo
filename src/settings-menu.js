/* =========================================================================
   설정 드롭다운 — 저장 위치/백업/불러오기/XLSX/프리셋 관리 + Everything 옵션.
   액션 버튼들(bkExp 등)의 실제 동작 리스너는 각자 모듈(backup.js 등)이
   갖고 있고, 여기서는 메뉴 여닫기와 체크 옵션 저장만 담당한다.
   ========================================================================= */
import {S} from './state.js';
import {STORE} from './store.js';
import {$} from './dom-utils.js';
import {openPresetModal} from './presets.js';

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

/* 체크 상태를 S.settings와 동기화 (메뉴 열 때마다 — 로드 완료 전 열어도 안전) */
export function syncSettingsMenu(){
  $('opt-ev-autostart').checked = !!S.settings.everythingAutostart;
  $('opt-ev-quick').checked = S.settings.everythingQuickSearch!==false;   // 기본 켬
}

export function initSettingsMenu(){
  const menu=$('settingsMenu');
  $('settingsBtn').addEventListener('click',e=>{
    e.stopPropagation(); syncSettingsMenu(); menu.classList.toggle('on');
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('#settingsMenu,#settingsBtn')) menu.classList.remove('on');
  });
  /* 액션 실행 시 메뉴 닫기 (체크 옵션 label 클릭은 열린 채 유지) */
  menu.addEventListener('click',e=>{ if(e.target.closest('button.menu-item')) menu.classList.remove('on'); });
  $('presetManageBtn').addEventListener('click',openPresetModal);
  $('opt-ev-autostart').addEventListener('change',e=>{ S.settings.everythingAutostart=e.target.checked; saveSettings(); });
  $('opt-ev-quick').addEventListener('change',e=>{ S.settings.everythingQuickSearch=e.target.checked; saveSettings(); });
}
