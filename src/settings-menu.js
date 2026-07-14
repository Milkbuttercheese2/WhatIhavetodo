/* =========================================================================
   설정 드롭다운 — 저장 위치/백업/불러오기/XLSX/프리셋 관리.
   액션 버튼들(bkExp 등)의 실제 동작 리스너는 각자 모듈(backup.js 등)이
   갖고 있고, 여기서는 메뉴 여닫기만 담당한다.
   ========================================================================= */
import {$} from './dom-utils.js';
import {openPresetModal} from './presets.js';

export function initSettingsMenu(){
  const menu=$('settingsMenu');
  $('settingsBtn').addEventListener('click',e=>{
    e.stopPropagation(); menu.classList.toggle('on');
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('#settingsMenu,#settingsBtn')) menu.classList.remove('on');
  });
  /* 액션 실행 시 메뉴 닫기 */
  menu.addEventListener('click',e=>{ if(e.target.closest('button.menu-item')) menu.classList.remove('on'); });
  $('presetManageBtn').addEventListener('click',openPresetModal);
}
