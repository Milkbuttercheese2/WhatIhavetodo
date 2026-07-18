/* =========================================================================
   바로 입력 + 양식 패널
   ========================================================================= */
import {S, newId, makeItem} from './state.js';
import {invoke} from './store.js';
import {$, esc, escAttr, enableDragReorder} from './dom-utils.js';
import {dtInner, dtInputHtml, refreshDow, readDtInput, validateAllDt, isoToDateStr, isoToTimeStr} from './datetime.js';
import {placeOf, PLACE_NAME} from './placement.js';
import {persist} from './render.js';

/* (1) 메모 텍스트 → 분류 대기. 바로 입력 버튼과 미니 캡처 창(capture-bridge)이 공용 */
export function captureMemo(t){
  t=String(t||'').trim(); if(!t) return false;
  S.items.push(makeItem({memo:t, staged:true, f:{received:new Date().toISOString()}}));
  persist(); return true;
}
/* 바로 입력 버튼/Ctrl+Enter — #inp 를 읽어 captureMemo 로 위임 */
export function toInbox(){
  const t=$('inp').value.trim(); if(!t){$('inp').focus();return;}
  captureMemo(t);
  $('inp').value=''; $('inp').style.height=''; $('inp').focus();   // 등록 후 높이 초기화(min-height로 복귀)
}
/* v2.5.4: 바로 입력창 자동 세로 확장 — 내용에 맞춰 늘어난다(최소 CSS min-height, 최대 60vh 뒤 스크롤).
   WebView2에서 드래그 리사이즈가 잘 안 잡히던 문제를 근본 해결(타이핑만으로 늘어남). resize 핸들은 그대로 둠. */
export function autoGrowInp(){
  const el=$('inp'); if(!el) return;
  el.style.height='auto';
  const min=parseFloat(getComputedStyle(el).minHeight)||0;
  const max=Math.max(min, Math.round(window.innerHeight*0.6));
  el.style.height=Math.min(Math.max(el.scrollHeight, min), max)+'px';
}

/* (2) 양식 패널 */
let editingId=null;
const enabled = () => S.fields.filter(f=>f.on);

export function openForm(pre){
  pre=pre||{};
  editingId=pre.id||null;
  $('fm-title').textContent=editingId?'양식 채우기 — 저장하면 규칙에 따라 자동 배치됩니다':'양식 입력';
  $('fm-memo').value = pre.memo || '';

  // 상위 시각 필드 (접수·마감)
  const g=$('fm-grid'); g.innerHTML='';
  enabled().forEach(f=>{
    const v=(pre.f||{})[f.key] ?? (f.key==='received'?new Date().toISOString():'');
    g.insertAdjacentHTML('beforeend',
      `<div class="fm-field"><label>${esc(f.label)}</label>${dtInputHtml('fm-dt', v, `data-fkey="${f.key}"`)}</div>`);
  });
  g.querySelectorAll('.dt-inp').forEach(refreshDow);

  // 관련인 세트
  const cw=$('fm-contacts'); cw.innerHTML='';
  const contacts = pre.contacts && pre.contacts.length ? pre.contacts : [{who:'',org:'',phone:''}];
  contacts.forEach(c=>addContactRow(c));

  // 식별번호
  const iw=$('fm-ids'); iw.innerHTML='';
  (pre.ids||[]).forEach(x=>addFormIdRow(x.kind,x.val));

  // 세부 할일
  const sw=$('fm-subs'); sw.innerHTML='';
  (pre.subs||[]).forEach(s=>addFormSubRow(s.title,s.mid,false,s));
  if(!(pre.subs||[]).length) addFormSubRow('','');

  // 파일 링크
  const fw=$('fm-files'); fw.innerHTML='';
  (pre.files||[]).forEach(p=>addFormFileRow(p));

  updatePlacePreview();
  $('formPanel').classList.add('on');
  const m=$('fm-memo'); m.focus();
  const pos=m.value.indexOf('○○'); if(pos>=0)m.setSelectionRange(pos,pos+2);
}
/* 팝업 닫기 — editingId 리셋까지 한 곳에서 (ESC·취소·저장 공용) */
export function closeForm(){ $('formPanel').classList.remove('on'); editingId=null; }

/* 관련인 행 — 연락처는 입력한 그대로 저장(자동 하이픈 없음: 지역번호·내선 등 파싱이 애매).
   대신 검색은 filters.js가 숫자만 버전도 haystack에 넣어 010-1234-5678 저장분이
   01012345678 검색으로도 걸린다(v2.5.1) */
function addContactRow(c){
  c=c||{who:'',org:'',phone:''};
  const row=document.createElement('div'); row.className='contact-row';
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <input type="text" class="c-org" placeholder="관련소속" value="${escAttr(c.org||'')}">
    <input type="text" class="c-who" placeholder="관련인" value="${escAttr(c.who||'')}">
    <input type="text" class="c-phone" placeholder="연락처" value="${escAttr(c.phone||'')}">
    <button class="rm" title="삭제">×</button>`;
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  /* Enter → 다음 행 이동/추가 (세부 할 일과 동일 UX, v2.5.3) — 같은 칸(열)으로 포커스.
     한글 IME 조합 중 Enter는 무시(조합 확정이 새 행을 만들지 않게). */
  row.querySelectorAll('input').forEach(inp=>inp.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.keyCode===229) return;
    e.preventDefault();
    const rows=[...$('fm-contacts').querySelectorAll('.contact-row')];
    const isLast=rows[rows.length-1]===row;
    if(isLast){ addContactRow(); $('fm-contacts').lastElementChild.querySelector('.'+inp.classList[0]).focus(); }
    else rows[rows.indexOf(row)+1].querySelector('.'+inp.classList[0]).focus();
  }));
  $('fm-contacts').appendChild(row);
}

/* 식별번호 행 */
function idKindOptions(){ return S.idKinds.concat(['기타']); }
function addFormIdRow(kind,val){
  const row=document.createElement('div'); row.className='fid-row';
  const opts=idKindOptions();
  const isEtc = !!kind && !S.idKinds.includes(kind);
  const sel = opts.map(k=>{ const s=(k===kind||(k==='기타'&&isEtc))?' selected':''; return `<option value="${escAttr(k)}"${s}>${esc(k)}</option>`; }).join('');
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>`
    + `<select class="fid-kind">${sel}</select>`
    + `<input type="text" class="fid-etc" placeholder="명칭 직접입력" value="${isEtc?escAttr(kind):''}" style="${isEtc?'':'display:none'}">`
    + `<input type="text" class="fid-val" placeholder="번호 입력" value="${escAttr(val||'')}">`
    + `<button class="rm" title="삭제">×</button>`;
  const selEl=row.querySelector('.fid-kind'), etcEl=row.querySelector('.fid-etc');
  selEl.addEventListener('change',()=>{ if(selEl.value==='기타'){etcEl.style.display='';etcEl.focus();} else etcEl.style.display='none'; });
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('fm-ids').appendChild(row);
}

/* 세부 할일 행 (Enter → 다음 줄 자동 생성) */
function addFormSubRow(title,mid,focusIt,sub){
  sub=sub||{};
  const row=document.createElement('div'); row.className='fsub-row';
  if(sub.id!=null) row.dataset.subid=sub.id;
  row.dataset.done = sub.done?'1':'0';
  const md=mid?{date:isoToDateStr(mid),time:isoToTimeStr(mid)}:{date:'',time:''};
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <div class="fsub-chk chk ${sub.done?'on':''}" title="완료 표시"></div>
    <input type="text" class="fsub-title" placeholder="세부 할 일" value="${escAttr(title||'')}">
    <input type="text" class="sub-owner" placeholder="담당" title="비우면 본인" value="${escAttr(sub.owner||'')}">
    <span class="dt-inp fsub-dt">${dtInner(md.date, md.time)}</span>
    <button class="rm" title="삭제">×</button>`;
  const chk=row.querySelector('.fsub-chk');
  chk.addEventListener('click',()=>{ const on=row.dataset.done==='1'; row.dataset.done=on?'0':'1'; chk.classList.toggle('on',!on);
    row.querySelector('.fsub-title').classList.toggle('sdone',!on); });
  if(sub.done) row.querySelector('.fsub-title').classList.add('sdone');
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  const titleInput=row.querySelector('.fsub-title');
  titleInput.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault();
      const rows=[...$('fm-subs').querySelectorAll('.fsub-row')];
      const isLast = rows[rows.length-1]===row;
      if(isLast){ addFormSubRow('','',true); }
      else { const next=rows[rows.indexOf(row)+1]; next&&next.querySelector('.fsub-title').focus(); }
    }
  });
  $('fm-subs').appendChild(row);
  refreshDow(row.querySelector('.dt-inp'));
  if(focusIt) titleInput.focus();
}

/* 파일 링크 행 — 체크 버튼으로 두 모드 전환:
   활성화(체크 on)=이름을 클릭하면 파일 열림(수정 잠금), 비활성화(off)=경로 직접 수정.
   경로 값은 항상 숨은 .ffile-path 인풋에 담겨 collectForm이 그대로 읽는다. */
function fileName(p){ p=String(p||'').trim(); return (p.split(/[\\/]/).filter(Boolean).pop()||p); }
function addFormFileRow(path, active){
  active = active!==false;                       // 기본 활성화(링크 모드)
  const row=document.createElement('div'); row.className='ffile-row';
  row.innerHTML=`<button type="button" class="ffile-toggle chk ${active?'on':''}" title="활성화: 이름 클릭 시 파일 열기 · 비활성화: 경로 수정/찾기"></button>
    <span class="ffile-link" title="열기" style="${active?'':'display:none'}">${esc(fileName(path)||'(경로 없음)')}</span>
    <input type="text" class="ffile-path" placeholder="파일 경로 (직접 붙여넣기 가능)" value="${escAttr(path||'')}" style="${active?'display:none':''}">
    <button type="button" class="ffile-browse" title="파일 찾기" style="${active?'display:none':''}">찾기</button>
    <button class="rm" title="삭제">×</button>`;
  const toggle=row.querySelector('.ffile-toggle'), link=row.querySelector('.ffile-link'),
        input=row.querySelector('.ffile-path'), browse=row.querySelector('.ffile-browse');
  const setMode=on=>{ link.style.display=on?'':'none'; input.style.display=on?'none':''; browse.style.display=on?'none':''; };
  toggle.addEventListener('click',()=>{
    const on=toggle.classList.toggle('on');
    if(on){ const p=input.value.trim(); link.textContent=fileName(p)||'(경로 없음)'; link.title='열기: '+p; }  // 활성화: 이름 갱신
    setMode(on);
    if(!on) input.focus();                        // 비활성화: 수정 편의상 포커스
  });
  link.addEventListener('click',()=>{ const p=input.value.trim();
    if(p) invoke('open_file_path',{path:p}).catch(err=>alert('파일을 열 수 없습니다:\n'+p+'\n\n'+err)); });
  browse.addEventListener('click',async()=>{     // 비활성화 모드에서 이 행의 경로를 새로 선택
    let p=null; try{ p=await invoke('pick_file_path'); }catch(e){ alert('파일 선택 실패: '+e); return; }
    if(p) input.value=p;
  });
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('fm-files').appendChild(row);
}

function collectForm(){
  const f={};
  $('fm-grid').querySelectorAll('[data-fkey]').forEach(sp=>{ const v=readDtInput(sp); f[sp.dataset.fkey] = (v===null?'':v); });
  const contacts=[...$('fm-contacts').querySelectorAll('.contact-row')].map(r=>({
    who:r.querySelector('.c-who').value.trim(), org:r.querySelector('.c-org').value.trim(), phone:r.querySelector('.c-phone').value.trim()
  })).filter(c=>c.who||c.org||c.phone);
  const ids=[...$('fm-ids').querySelectorAll('.fid-row')].map(r=>{
    const sel=r.querySelector('.fid-kind').value, etc=r.querySelector('.fid-etc').value.trim(), val=r.querySelector('.fid-val').value.trim();
    const kind=sel==='기타'?(etc||'기타'):sel; return val?{kind,val}:null;
  }).filter(Boolean);
  const subs=[...$('fm-subs').querySelectorAll('.fsub-row')].map(r=>{
    const t=r.querySelector('.fsub-title').value.trim(); if(!t)return null;
    const dt=r.querySelector('.fsub-dt'); const raw=readDtInput(dt); const mid=(raw===null?'':raw);
    const id = r.dataset.subid!=null && r.dataset.subid!=='' ? Number(r.dataset.subid) : newId();
    const done = r.dataset.done==='1';
    // 기존 세부의 알람 확인 상태(al) 보존. 단 점검시각이 바뀌면 알람 재무장.
    let al={};
    if(editingId){ const cur=S.items.find(x=>x.id===editingId); const prev=cur&&(cur.subs||[]).find(s=>s.id===id);
      if(prev){ al = (prev.mid===mid) ? (prev.al||{}) : {}; } }
    return {id, title:t, mid, done, al, owner:r.querySelector('.sub-owner').value.trim()};
  }).filter(Boolean);
  const files=[...$('fm-files').querySelectorAll('.ffile-path')].map(i=>i.value.trim()).filter(Boolean);
  // 항목 담당자 입력은 v2.5.2 제거 — 담당은 세부할일 전용. 기존 it.owner는 저장 시 건드리지 않아 보존된다.
  return {memo:$('fm-memo').value.trim(), f, contacts, ids, subs, files};
}
function updatePlacePreview(){ try{ const d=collectForm(); const p=placeOf({staged:false,f:d.f,subs:d.subs}); $('fm-place').innerHTML=`저장 위치: <b>${PLACE_NAME[p]}</b>`; }catch{} }

export function initForm(){
  // 팝업이 어느 탭에서든 뜨도록 formPanel을 body 직속으로 이동
  document.body.appendChild($('formPanel'));
  $('toInbox').addEventListener('click', toInbox);
  $('inp').addEventListener('keydown',e=>{ if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();toInbox();} });
  $('inp').addEventListener('input', autoGrowInp);   // v2.5.4: 입력 시 자동 세로 확장
  $('fm-contactadd').addEventListener('click',()=>addContactRow());
  $('fm-idadd').addEventListener('click',()=>{
    addFormIdRow(S.idKinds[0]||'기타','');
  });
  $('fm-subadd').addEventListener('click',()=>addFormSubRow('','',true));
  enableDragReorder($('fm-subs'), '.fsub-row', '.drag-handle');
  enableDragReorder($('fm-ids'), '.fid-row', '.drag-handle');        // v2.5.1 식별번호도 드래그 정렬
  enableDragReorder($('fm-contacts'), '.contact-row', '.drag-handle'); // v2.5.3 관련인도 드래그 정렬
  $('fm-fileadd').addEventListener('click', async ()=>{
    let p=null;
    try{ p=await invoke('pick_file_path'); }
    catch(e){ alert('파일 선택 실패: '+e); return; }
    if(p) addFormFileRow(p);
  });
  $('blankForm').addEventListener('click',()=>{ const t=$('inp').value.trim(); openForm(t?{memo:t}:{}); if(t){$('inp').value='';$('inp').style.height='';} });
  $('fm-cancel').addEventListener('click',closeForm);
  $('formPanel').addEventListener('input',e=>{ if(e.target.closest('#fm-grid,#fm-subs')) updatePlacePreview(); });
  $('fm-save').addEventListener('click',()=>{
    // F3: 저장 전 오입력 검사 (포커스 남아있으면 판정되도록 먼저 blur)
    if(document.activeElement && $('formPanel').contains(document.activeElement)) document.activeElement.blur();
    if(!validateAllDt($('formPanel'))){
      alert('날짜·시각 입력이 올바르지 않습니다.\n빨갛게 표시된 칸을 확인해주세요.\n(예: 2026/07/10 · 18:30)');
      return;
    }
    const d=collectForm();
    const prev = editingId ? S.items.find(x=>x.id===editingId) : null;
    if(editingId){
      const it=prev;
      if(it){
        const oldDue=(it.f||{}).due;
        // it.owner는 그대로 둔다 — 항목 담당자 UI 제거(v2.5.2), 저장돼 있던 값은 보존(데이터 호환)
        it.memo=d.memo; it.f=d.f; it.contacts=d.contacts; it.ids=d.ids; it.subs=d.subs; it.files=d.files; it.staged=false;
        it.al = it.al || {};
        if(oldDue !== d.f.due) delete it.al.due;   // F2: 마감이 바뀌면 알람 재무장
      }
    }else{
      S.items.push(makeItem({memo:d.memo, staged:false, f:d.f, contacts:d.contacts, ids:d.ids, subs:d.subs, files:d.files}));
    }
    closeForm(); persist();
  });
}
