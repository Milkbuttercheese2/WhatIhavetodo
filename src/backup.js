/* =========================================================================
   백업/복원 (JSON·DB) + XLSX 내보내기 + 저장 위치 변경
   ========================================================================= */
import {S, CORE_FIELDS, DEFAULT_SETTINGS, migrateItem} from './state.js';
import {STORE, invoke} from './store.js';
import {$, showToast} from './dom-utils.js';
import {placeOf, PLACE_NAME} from './placement.js';
import {renderPresets} from './presets.js';
import {renderAlarmToggle} from './alarms.js';
import {persist} from './render.js';

/* [JSON파일 백업] / Ctrl+S — 저장창을 띄워 폴더·이름 지정.
   한 번 지정하면 그 파일 핸들을 기억해 이후엔 같은 파일에 조용히 저장. */
/* v2.5.11: 백업에 임시 상태 captureDraft 를 넣지 않는다 — 넣으면 복원 후 다음 실행에
   초안이 유령 항목으로 등록돼(main.js 초안 회수), 백업 안 원본 항목과 중복될 수 있다. */
function backupPayload(){ const settings={...S.settings, captureDraft:''};
  return JSON.stringify({v:5,exported:new Date().toISOString(),fields:S.fields,presets:S.presets,idKinds:S.idKinds,settings,recurDefs:S.recurDefs,items:S.items},null,1); }
function backupName(){ const n=new Date(); return `뭐하려했더라_백업_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.json`; }
async function doBackup(){
  const text=backupPayload();
  // Tauri 창은 브라우저가 아니라 blob+<a download> 클릭을 받아줄 다운로드
  // 관리자가 없다 — 네이티브 "저장" 대화상자를 직접 띄워야 실제로 저장된다.
  try{
    const saved=await invoke('save_text_file', {suggestedName:backupName(), content:text});
    if(saved) showToast('백업 파일을 저장했습니다');
  }catch(e){ alert('백업 저장 실패: '+e); }
}
export function reconcileImported(){
  const imp=S.imported;
  if(imp.presets){ S.presets=imp.presets; imp.presets=null; window.PRESETS=S.presets; STORE.savePresets(S.presets); renderPresets(); }
  if(imp.idKinds){ S.idKinds=imp.idKinds.filter(k=>k&&k!=='기타'); imp.idKinds=null; window.ID_KINDS=S.idKinds; STORE.saveIdKinds(S.idKinds); }
  if(imp.settings){ S.settings=Object.assign({},DEFAULT_SETTINGS,imp.settings); imp.settings=null; window.SETTINGS=S.settings; STORE.saveSettings(S.settings); renderAlarmToggle(); }
  /* 구 정기함(v2.3) 정의 — 기능은 제거됐지만 데이터는 백업 왕복을 위해 보존만 한다
     (초기 로드는 DB에 이미 있고, JSON 복원은 backup_import 트랜잭션이 이미 저장함) */
  if(imp.recurDefs){ S.recurDefs=imp.recurDefs; imp.recurDefs=null; }
  if(imp.fields){ let f=imp.fields; imp.fields=null;
    const custom=f.filter(x=>!CORE_FIELDS.some(cf=>cf.key===x.key)&&!['who','org','phone','mid','notice','sr'].includes(x.key));
    S.fields=CORE_FIELDS.map(cf=>{const ex=f.find(x=>x.key===cf.key);return ex?Object.assign({},cf,{on:true,builtin:true}):JSON.parse(JSON.stringify(cf));}).concat(custom);
    window.FIELDS=S.fields; STORE.saveFields(S.fields); }
}

export function initBackup(){
  /* XLSX */
  $('xlsx').addEventListener('click', async ()=>{
    // 분류 대기·예정 항목은 아직 손 안 댄 메모라 보고용 목록에는 의미가 적어
    // 제외 — 오늘 처리·진행 중·완료(=실제로 다루고 있거나 다룬 업무)만 담는다.
    // (시간·담당자 모드에서는 오늘 두 열(metoday/othtoday)이 같은 역할.
    //  v2.5.1: 무시각 업무가 '오늘 외'로 가게 되면서, 손 댄(세부 일부 완료=시간 모드의
    //  '진행 중' 상당) 업무가 오늘 외 열에 있어도 누락되지 않게 started 조건을 추가)
    const started=it=>(it.subs||[]).some(s=>s.done);
    const exportable=S.items.filter(it=>{const p=placeOf(it);
      return it.done||['today','doing','metoday','othtoday'].includes(p)||(['meplan','othplan'].includes(p)&&started(it));});
    if(!exportable.length){alert('내보낼 항목이 없습니다 (오늘 처리·진행 중·완료된 업무만 내보냅니다).');return;}
    const fx=iso=>{ if(!iso)return''; const d=new Date(iso); if(isNaN(d))return'';
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
    const rows=exportable.map(it=>{
      const subs=it.subs||[];
      return {
        '구역':PLACE_NAME[placeOf(it)],
        '메모':it.memo||'',
        '관련인':(it.contacts||[]).map(c=>c.who).filter(Boolean).join(', '),
        '관련소속':(it.contacts||[]).map(c=>c.org).filter(Boolean).join(', '),
        '연락처':(it.contacts||[]).map(c=>c.phone).filter(Boolean).join(', '),
        '접수시각':fx((it.f||{}).received),
        '마감시각':fx((it.f||{}).due),
        '식별정보':(it.ids||[]).map(x=>`${x.kind}: ${x.val}`).join(' · '),
        '세부진행':subs.length?`${subs.filter(s=>s.done).length}/${subs.length}`:'',
        '세부내역':subs.map(s=>(s.done?'[완료] ':'')+s.title+(s.mid?` (점검 ${fx(s.mid)})`:'')).join(' · '),
        '파일링크':(it.files||[]).join(' · ')
      };
    });
    const ws=XLSX.utils.json_to_sheet(rows); const cols=Object.keys(rows[0]);
    ws['!cols']=cols.map(c=>({wch:Math.max(10,Math.min(46,rows.reduce((m,r)=>Math.max(m,String(r[c]||'').length*1.7),c.length*2)))}));
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'업무목록');
    const n=new Date();
    const name=`뭐하려했더라_업무목록_${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}.xlsx`;
    // XLSX.writeFile()은 브라우저의 blob+<a download> 다운로드에 의존하는데,
    // Tauri 창은 그걸 받아줄 다운로드 관리자가 없어 조용히 아무 일도 안 일어난다
    // (JSON 백업도 같은 이유로 안 됐던 것과 동일한 원인) — 바이트를 직접 뽑아
    // 네이티브 저장 대화상자로 넘긴다.
    // F14: {type:'array'}는 이 SheetJS 빌드에서 length가 없는 순수 ArrayBuffer를
    // 반환해 Array.from()이 조용히 빈 배열을 만들어버린다(= 0바이트 파일, "파일 형식
    // 문제"로 안 열림) — Uint8Array로 감싸야 실제 바이트가 나온다.
    const bytes=Array.from(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx'})));
    try{
      const saved=await invoke('save_binary_file', {suggestedName:name, data:bytes});
      if(saved) showToast('XLSX 파일을 저장했습니다');
    }catch(e){ alert('XLSX 저장 실패: '+e); }
  });

  /* 저장 위치 변경 */
  $('dataDirBtn').addEventListener('click', async e=>{
    e.preventDefault();
    let cur; try{ cur=await invoke('get_data_dir'); }catch(err){ alert('저장 위치 확인 실패: '+err); return; }
    if(!confirm(`현재 저장 위치:\n${cur}\n\n다른 위치로 변경할까요?\n(아무 위치나 고르시면 그 안에 전용 폴더를 새로 만듭니다. 데이터는 다음 재시작 때 그 시점의 최신 상태 그대로 새 위치로 옮겨집니다)`))return;
    let picked; try{ picked=await invoke('choose_data_dir'); }catch(err){ alert('위치 선택 실패: '+err); return; }
    if(!picked)return; // 취소함
    if(confirm(`새 저장 위치가 예약되었습니다:\n${picked}\n\n다시 시작할 때 데이터가 새 위치로 옮겨집니다. 지금 재시작할까요?\n(나중에 재시작해도 그때까지의 수정 내용이 전부 함께 옮겨지니 안전합니다)`)){
      invoke('restart_app');
    }
  });

  /* 백업/복원 */
  $('bkExp').addEventListener('click',e=>{ e.preventDefault(); doBackup(); });

  /* 불러오기 — JSON 백업과 DB(.sqlite) 파일 중 아무거나 하나의 파일 선택창으로
     고를 수 있다. JSON은 즉시 반영(재시작 불필요), DB 파일은 통째로 교체 후
     재시작이 필요하다(저장 위치 변경과 동일한 이유 — 열려있는 SQLite 연결을
     그대로 두고 파일만 바꾸는 게 아니라, 안전하게 다시 여는 쪽이 단순하고
     확실하다). */
  $('bkImp').addEventListener('click', async e=>{
    e.preventDefault();
    let result;
    try{ result=await invoke('import_backup_file'); }
    catch(err){ alert('불러오기 실패: '+err); return; }
    if(result.kind==='Cancelled')return;

    if(result.kind==='Json'){
      let d;
      try{ d=JSON.parse(result.content); if(!Array.isArray(d.items))throw 0; }
      catch{ alert('백업 파일 형식이 올바르지 않습니다.'); return; }
      if(!confirm(`백업 파일에 업무 ${d.items.length}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?`))return;
      // 구버전 백업 호환은 프론트 책임: 아이템 마이그레이션 + 빠진 섹션은
      // 현재 값으로 채워서 완전한 payload를 만든 뒤, Rust의 backup_import로
      // 5개 테이블을 "한 트랜잭션"에 복원한다. (예전 방식은 items는 save_all,
      // 나머지는 각각 따로 fire-and-forget으로 흩어 저장해서, 중간에 앱이
      // 종료되면 반쪽짜리 상태가 남을 수 있었다.)
      const migrated=d.items.map(migrateItem);
      const payload={
        v:5, exported:d.exported||new Date().toISOString(),
        fields:Array.isArray(d.fields)?d.fields:S.fields,
        presets:Array.isArray(d.presets)?d.presets:S.presets,
        idKinds:Array.isArray(d.idKinds)?d.idKinds:S.idKinds,
        settings:(d.settings&&typeof d.settings==='object')?d.settings:S.settings,
        recurDefs:Array.isArray(d.recurDefs)?d.recurDefs:S.recurDefs,
        items:migrated
      };
      try{ await invoke('backup_import',{payload}); }
      catch(err){ alert('백업 복원 실패 (데이터는 변경되지 않았습니다): '+err); return; }
      // DB 복원이 성공한 뒤에만 메모리 상태를 갈아끼운다
      S.items=migrated;
      S.imported.fields=payload.fields;
      S.imported.presets=payload.presets;
      S.imported.idKinds=payload.idKinds;
      S.imported.settings=payload.settings;
      S.imported.recurDefs=payload.recurDefs;
      reconcileImported(); persist();
      showToast(`백업 ${migrated.length}건을 복원했습니다`);
      return;
    }

    // result.kind === 'Db' — 검증·대기 등록까지만 된 상태. JSON 쪽과 같은
    // 문구·같은 확인 절차를 거치고, 거절하면 대기 등록을 실제로 취소한다.
    if(!confirm(`백업 파일에 업무 ${result.items}건이 들어 있습니다.\n현재 데이터를 덮어쓰고 복원할까요?\n(DB 파일 복원은 재시작할 때 적용됩니다)`)){
      try{ await invoke('cancel_pending_import'); }catch{}
      showToast('복원을 취소했습니다');
      return;
    }
    if(confirm('지금 재시작할까요?')){
      invoke('restart_app');
    }else{
      alert('다음에 앱을 다시 시작하면 복원이 적용됩니다.');
    }
  });
}
