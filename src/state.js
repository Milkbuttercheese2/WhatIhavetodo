/* =========================================================================
   공유 상태 — 모듈 간 가변 상태는 전부 이 S 객체 하나로 공유한다.
   import 바인딩은 재대입이 불가하므로 반드시 프로퍼티 변경(S.items = ...)만 할 것.
   ========================================================================= */
export const CORE_FIELDS = [
  {key:'received', label:'접수시각', type:'datetime', on:true, builtin:true},
  {key:'due',      label:'마감시각', type:'datetime', on:true, builtin:true},
];
export const DEFAULT_ID_KINDS = ['입찰공고번호','계약체결번호','공사관리번호','SR번호','국민신문고번호'];
/* captureShortcut·closeToTray·autostartMinimized 기본값은 Rust 쪽
   (commands.rs DEFAULT_CAPTURE_SHORTCUT, lib.rs sget_bool 기본 인자)과
   반드시 동일해야 한다 — 새 DB에는 settings 행이 없어 양쪽이 각자 파생한다. */
export const DEFAULT_SETTINGS = {
  alarmOn:true,
  captureShortcut:'Ctrl+Alt+Space',   // 미니 캡처 창 전역 단축키
  closeToTray:true,                   // 메인 창 X = 종료 대신 트레이로
  autostart:false,                    // Windows 시작 시 자동 실행 (레지스트리 쓰기라 기본 꺼짐)
  autostartMinimized:true,            // 자동 실행 시 창 없이 트레이로만
  trayNoticeShown:false,              // "트레이에서 계속 실행" 첫 안내를 이미 봤는가
};
export const DEFAULT_PRESETS = [];

export const S = {
  items: [],
  fields: JSON.parse(JSON.stringify(CORE_FIELDS)),
  presets: JSON.parse(JSON.stringify(DEFAULT_PRESETS)),
  idKinds: DEFAULT_ID_KINDS.slice(),
  settings: Object.assign({}, DEFAULT_SETTINGS),
  /* 정기함 — 반복 일정 정의들(보드 밖 생성기). reconcileRecur가 도래 시 보드에 스폰 */
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

/* 아이템 모양의 단일 출처. 캡처·양식 저장·마이그레이션·정기 스폰이 전부 이걸 거치므로
   새 필드는 여기 기본값 한 줄만 추가하면 된다. recurId는 정기함이 스폰한 회차가
   자기 정의를 가리키는 소프트 링크(직접 만든 항목은 null).
   partial에 id가 없으면 newId()를 부여. Rust Item 구조체(model.rs)와 형태가 짝이다. */
export function makeItem(partial={}){
  const it = Object.assign(
    {memo:'', done:false, doneAt:null, staged:false, f:{}, contacts:[], ids:[], subs:[], al:{}, recurId:null},
    partial);
  if(it.id==null) it.id = newId();
  return it;
}

/* 완료 상태 토글 — 도메인 연산(순수 변경, persist/render는 호출부 책임).
   정기 회차도 일반 항목과 똑같이 완료되어 done으로 떠난다('완료=떠남' 불변식). */
export function toggleDone(it){
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : null;
  return it;
}

/* =========================================================================
   정기함 (v2.3) — 반복은 보드 밖 '정의(recurDef)'로 두고, 도래 시점에 일반
   메모를 보드에 스폰하는 생성기. recurDef = {id, memo, freq, dow?, time:{hh,mm},
   next:ISO, paused}. freq: 'daily'|'weekly'|'monthly', dow: 매주 선택 요일(0=일..6=토).
   ========================================================================= */
/* 주어진 ISO 시각을 규칙에 따라 '다음 도래' ISO로. 시:분은 보존.
   def(또는 {freq,dow})를 받는다. */
export function nextRecurDate(iso, def){
  const d = new Date(iso);
  if(isNaN(d) || !def) return iso;
  if(def.freq === 'daily'){ d.setDate(d.getDate()+1); return d.toISOString(); }
  if(def.freq === 'weekly'){
    const dow = (Array.isArray(def.dow) && def.dow.length) ? def.dow : [d.getDay()];
    for(let i=1;i<=7;i++){ const c=new Date(d); c.setDate(d.getDate()+i); if(dow.includes(c.getDay())) return c.toISOString(); }
    return iso;   // 이론상 도달 안 함
  }
  if(def.freq === 'monthly'){
    const day=d.getDate(), t=new Date(d); t.setDate(1); t.setMonth(t.getMonth()+1);
    const dim=new Date(t.getFullYear(), t.getMonth()+1, 0).getDate();   // 다음 달 총 일수
    t.setDate(Math.min(day, dim));                                       // 짧은 달 클램프(1/31 → 2/28)
    t.setHours(d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
    return t.toISOString();
  }
  return iso;
}
/* 로컬 자정 기준 그 날의 시작(ms). 손상 ISO는 NaN. */
export function dayStart(iso){ const d=new Date(iso); if(isNaN(d)) return NaN; d.setHours(0,0,0,0); return d.getTime(); }

/* 정기 정의들을 훑어 '도래한 회차'를 보드에 일반 메모로 스폰한다. 순수 변경(S만
   건드림) — 무언가 바뀌면 true 반환, 호출부가 items+recurDefs를 저장한다.
   규칙: 정의당 열린(미완료) 회차는 최대 1건. 회차의 '날'이 시작돼야 스폰(마감 시각이
   아니라 그 날 자정 기준). 앱이 꺼져 있어 놓친 회차들은 가장 최근 것 하나로 접는다. */
export function reconcileRecur(now=new Date()){
  const ts=new Date(now); ts.setHours(0,0,0,0); const t0=ts.getTime();
  let changed=false;
  for(const def of (S.recurDefs||[])){
    if(def.paused || !def.next) continue;
    if(S.items.some(it=>it.recurId===def.id && !it.done)) continue;   // 이미 열린 회차 있음 → 대기
    // 놓친 회차 접기: 다음 회차의 '날'이 오늘 이하인 동안 계속 전진(가장 최근 것만 남김)
    let guard=0;
    while(guard++<3660){ const nx=nextRecurDate(def.next, def); if(nx===def.next || dayStart(nx)>t0) break; def.next=nx; changed=true; }
    // 그 회차의 날이 시작됐으면(오늘 이하) 스폰
    if(dayStart(def.next) <= t0){
      S.items.push(makeItem({memo:def.memo, staged:false, recurId:def.id,
        f:{received:new Date(now).toISOString(), due:def.next}}));
      def.next = nextRecurDate(def.next, def);
      changed=true;
    }
  }
  return changed;
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
