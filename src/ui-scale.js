/* =========================================================================
   화면 크기(확대 배율) — v2.5.15
   내부망 PC에서 글자가 너무 작다는 요구. Ctrl+휠로 그 자리에서 키우고 줄인다.

   왜 글자 크기가 아니라 화면 전체를 확대하나:
   styles.css 의 font-size 104곳을 곱해도 고정폭 요소(날짜 112px·시각 64px·
   담당 96px·식별 select 130px·보드 열 minmax)는 그대로라 글자가 넘친다 —
   v2.5.8~v2.5.10에서 세 번 연속 고쳤던 바로 그 Windows 레이아웃 깨짐이다.
   zoom 은 글자·여백·고정폭을 함께 비례 확대해 배치 비율을 지킨다.

   왜 맨 휠이 아니라 Ctrl+휠인가: 보드 열·완료 목록·달력이 모두 세로 스크롤을
   쓴다. 맨 휠에 확대를 걸면 목록을 내릴 방법이 없어진다.

   저장은 settings.uiScale(%) — settings 는 자유 키-값 JSON 맵이라 Rust 모델·
   마이그레이션 변경이 필요 없다. 빠른 메모 창은 열릴 때마다 이 값을 다시 읽어
   따라온다(capture-win.js).
   ========================================================================= */
import { S } from './state.js';
import { STORE } from './store.js';
import { showToast } from './dom-utils.js';

export const MIN_SCALE = 80, MAX_SCALE = 150, SCALE_STEP = 10;

let saveTimer = null;

/* 저장값 정규화 — 범위 밖은 자르고, 10% 격자에 맞추고, 손상값은 등배로.
   미설정(undefined/null/'')은 반드시 100이어야 한다: Number(null)===0 이라
   그냥 clamp 하면 하한 80%로 떨어져, 설정을 만진 적 없는 사용자의 화면이
   제멋대로 작아진다. */
export function normScale(v){
  if(v === undefined || v === null || v === '') return 100;
  const n = Number(v);
  if(!Number.isFinite(n)) return 100;
  const snapped = Math.round(n / SCALE_STEP) * SCALE_STEP;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, snapped));
}

/* 한 칸 이동 — dir > 0 이면 확대, < 0 이면 축소. 끝에 닿으면 그대로. */
export function stepScale(cur, dir){
  return normScale(normScale(cur) + (dir > 0 ? SCALE_STEP : -SCALE_STEP));
}

/* 실제 적용 — Rust 쪽에서 메인·빠른메모 두 웹뷰에 함께 건다.

   CSS zoom 이 아니라 웹뷰 자체 배율을 쓰는 이유: CSS zoom 은 뷰포트 크기를
   바꾸지 않아 미디어 쿼리가 속는다. 컴팩트(560px) 창에서 확대하면 560px 기준
   레이아웃 그대로 내용만 커져 가로로 넘친다(v2.5.9~v2.5.10에서 고친 그 문제).
   또 vh·innerHeight 도 확대를 모른 채 계산돼, 모달이 화면 밖으로 넘치거나
   보드에 늘 세로 스크롤이 생긴다. 웹뷰 배율은 CSS 픽셀 뷰포트 자체를 줄이므로
   이 셋이 전부 저절로 맞는다 — 보정 코드가 필요 없다. */
export function applyUiScale(v){
  const n = normScale(v);
  STORE.setUiScale(n);
  return n;
}

/* 휠은 연속으로 쏟아지므로 저장은 묶어서 한 번만 (DB 쓰기 폭주 방지). */
function saveScaleSoon(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if(S.loaded) STORE.saveSettings(S.settings); }, 400);
}

export function initUiScale(){
  /* passive:false — preventDefault 로 브라우저 기본 확대·스크롤을 막아야 한다. */
  window.addEventListener('wheel', e => {
    if(!e.ctrlKey || !e.deltaY) return;
    e.preventDefault();
    const next = stepScale(S.settings.uiScale, e.deltaY < 0 ? 1 : -1);   // 위로 굴리면 확대
    if(next === normScale(S.settings.uiScale)) return;                   // 상·하한에서 조용히 멈춤
    S.settings.uiScale = next;
    applyUiScale(next);
    showToast(`화면 크기 ${next}%`);
    saveScaleSoon();
  }, {passive:false});
}
