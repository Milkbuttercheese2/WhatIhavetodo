/* =========================================================================
   공유 상태 — 모듈 간 가변 상태는 전부 이 S 객체 하나로 공유한다.
   import 바인딩은 재대입이 불가하므로 반드시 프로퍼티 변경(S.items = ...)만 할 것.
   ========================================================================= */
export const CORE_FIELDS = [
  {key:'received', label:'접수시각', type:'datetime', on:true, builtin:true},
  {key:'due',      label:'마감시각', type:'datetime', on:true, builtin:true},
];
export const DEFAULT_ID_KINDS = ['입찰공고번호','계약체결번호','공사관리번호','SR번호','국민신문고번호'];
/* closeToTray 기본값은 Rust 쪽(lib.rs sget_bool 기본 인자)과 반드시 동일해야
   한다 — 새 DB에는 settings 행이 없어 양쪽이 각자 파생한다. 캡처 단축키는
   v2.31부터 Ctrl+Alt+Space 고정(commands.rs CAPTURE_SHORTCUT) — 설정이 아니다. */
export const DEFAULT_SETTINGS = {
  alarmOn:true,
  closeToTray:true,                   // 메인 창 X = 종료 대신 트레이로
  trayNoticeShown:false,              // "트레이에서 계속 실행" 첫 안내를 이미 봤는가
};
export const DEFAULT_PRESETS = [];

export const S = {
  items: [],
  fields: JSON.parse(JSON.stringify(CORE_FIELDS)),
  presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS)),
  idKinds: DEFAULT_ID_KINDS.slice(),
  settings: Object.assign({}, DEFAULT_SETTINGS),
  /* 구 정기함(v2.3) 정의들 — 기능은 v2.31에서 제거됐지만 DB·JSON 백업에 남은
     데이터가 유실되지 않도록 로드/백업 왕복만 유지한다 (생성기·UI 없음) */
  recurDefs: [],
  /* F1: 초기 로드 완료 게이트. 로드 전 저장을 막아 기존 데이터 소실을 방지 */
  loaded: false,
  /* F12: 단조 증가 ID — 같은 ms 내 충돌 방지 */
  lastId: 0,
  /* 비동기 핸드오프 채널 — STORE.load()·백업 복원이 채우고 reconcileImported()가 소비
     (구 window.__imported* 를 모듈 상태로 대체) */
  imported: {fields:null, presets:null, idKinds:null, settings:null, recurDefs:null},
};

/* F12: 단조 증가 ID — 같은 ms 내 충돌 방지 */
export function newId(){
  const t = Date.now();
  S.lastId = (t > S.lastId) ? t : S.lastId + 1;
  return S.lastId;
}

/* 아이템 모양의 단일 출처. 캡처·양식 저장·마이그레이션이 전부 이걸 거치므로
   새 필드는 여기 기본값 한 줄만 추가하면 된다. recurId는 구 정기함(v2.3)이 스폰한
   회차가 정의를 가리키던 소프트 링크 — 기존 데이터 호환을 위해 형태만 유지한다.
   partial에 id가 없으면 newId()를 부여. Rust Item 구조체(model.rs)와 형태가 짝이다. */
export function makeItem(partial={}){
  const it = Object.assign(
    {memo:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], files:[], al:{}, recur:null, recurId:null},
    partial);
  if(it.id==null) it.id = newId();
  return it;
}

/* 완료 상태 토글 — 도메인 연산(순수 변경, persist/render는 호출부 책임). */
export function toggleDone(it){
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : null;
  return it;
}

/* 코어 필드 병합 — 사용자 정의 필드는 유지하되 접수·마감은 항상 내장으로 강제 */
export function reconcileCore(){
  const custom = S.fields.filter(f=>!CORE_FIELDS.some(cf=>cf.key===f.key) && !['who','org','phone','mid','notice','sr'].includes(f.key));
  const merged = CORE_FIELDS.map(cf=>{ const ex=S.fields.find(x=>x.key===cf.key); return ex?Object.assign({},cf,{on:true,builtin:true}):JSON.parse(JSON.stringify(cf)); });
  S.fields = merged.concat(custom); window.FIELDS=S.fields;
}

/* =========================================================================
   구버전 아이템 마이그레이션 → v5 구조
   who/org/phone(f) → contacts[], mid(f) 제거, title/summary → memo, notice/sr → ids
   ========================================================================= */
export function migrateItem(o){
  const it=Object.assign({}, o);
  it.f=Object.assign({}, o.f||{});
  it.contacts=Array.isArray(o.contacts)?o.contacts:[];
  it.ids=Array.isArray(o.ids)?o.ids.slice():[];
  it.subs=Array.isArray(o.subs)?o.subs:[];
  it.files=Array.isArray(o.files)?o.files.slice():[];   // v3.0.0 파일 링크 (구버전 데이터엔 없음)
  it.recur=(o.recur&&typeof o.recur==='object')?o.recur:null;   // v3.1.0 주기 업무 (구버전엔 없음)
  // 메모 승계
  if(it.memo==null) it.memo = o.memo || o.title || '';
  // 관련인 승계
  if(!it.contacts.length && (it.f.who||it.f.org||it.f.phone)){
    it.contacts.push({who:it.f.who||'',org:it.f.org||'',phone:it.f.phone||''});
  }
  delete it.f.who; delete it.f.org; delete it.f.phone;
  // 상위 중간점검 → 세부로 흡수 불가하니 제거(세부 mid만 사용)
  if(it.f.mid){ delete it.f.mid; }
  // notice/sr → ids
  if(it.f.notice){ it.ids.push({kind:'입찰공고번호',val:it.f.notice}); delete it.f.notice; }
  if(it.f.sr){ it.ids.push({kind:'SR번호',val:it.f.sr}); delete it.f.sr; }
  // 식별번호 개수 제한 없음
  if(typeof it.title!=='undefined') delete it.title;
  // F12: 구버전 백업의 누락된 세부 id 보정 (없으면 편집 때마다 al 초기화됨)
  it.subs = it.subs.map(s=>{
    const t=Object.assign({}, s);
    if(t.id==null || t.id==='') t.id = newId();
    if(!t.al || typeof t.al!=='object') t.al = {};
    return t;
  });
  // _lastId 시드: 기존 id보다 항상 크게
  const maxId = Math.max(Number(it.id)||0, ...it.subs.map(s=>Number(s.id)||0));
  if(maxId > S.lastId) S.lastId = maxId;
  return it;
}
