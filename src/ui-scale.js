/* =========================================================================
   화면 크기(확대 배율) — v2.6.0
   내부망 PC에서 글자가 너무 작다는 요구. 글자 크기만 키우는 방식은 쓰지 않는다:
   styles.css 의 font-size 104곳을 곱해도 고정폭 요소(날짜 112px·시각 64px·
   담당 96px·식별 select 130px·보드 열 minmax)는 그대로라 글자가 넘친다 —
   v2.5.8~v2.5.10에서 세 번 연속 고쳤던 바로 그 Windows 레이아웃 깨짐이다.
   대신 zoom 으로 글자·여백·고정폭을 함께 비례 확대해 레이아웃 비율을 지킨다.

   저장은 settings.uiScale(%) — settings 는 자유 키-값 JSON 맵이라 Rust 모델·
   마이그레이션 변경이 필요 없다.
   ========================================================================= */
import { S } from './state.js';
import { STORE } from './store.js';
import { $ } from './dom-utils.js';

export const UI_SCALES = [100, 115, 130];

/* 저장값 정규화 — 목록 밖 값·손상값은 전부 등배로. */
export function normScale(v){
  const n = Math.round(Number(v));
  return UI_SCALES.includes(n) ? n : 100;
}

/* 실제 적용. 100%면 zoom 을 아예 비워 기본 렌더 경로를 그대로 둔다. */
export function applyUiScale(v){
  const n = normScale(v);
  document.body.style.zoom = n === 100 ? '' : String(n / 100);
  return n;
}

function syncUiScaleSel(n){
  [...$('uiScaleModal').querySelectorAll('.bm-opt')].forEach(x =>
    x.classList.toggle('on', Number(x.dataset.scale) === n));
}

export function closeUiScaleModal(){ $('uiScaleModal').classList.remove('on'); }

export function initUiScale(){
  document.body.appendChild($('uiScaleModal'));   // 어느 탭에서든 뜨도록 body 직속
  $('uiScaleBtn').addEventListener('click', () => {
    syncUiScaleSel(normScale(S.settings.uiScale));
    $('uiScaleModal').classList.add('on');
  });
  $('uiScaleClose').addEventListener('click', closeUiScaleModal);
  $('uiScaleModal').addEventListener('click', e => {
    const b = e.target.closest('.bm-opt');
    if(b){
      const n = normScale(b.dataset.scale);
      if(normScale(S.settings.uiScale) !== n){
        S.settings.uiScale = n;
        applyUiScale(n);
        STORE.saveSettings(S.settings);
      }
      syncUiScaleSel(n); return;                  // 선택 즉시 적용, 모달은 열어둔다
    }
    if(e.target.id === 'uiScaleModal') closeUiScaleModal();   // 배경 클릭 닫기
  });
}
