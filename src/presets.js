/* =========================================================================
   프리셋 + 프리셋 관리 모달 (식별번호 명칭 관리 포함)
   ========================================================================= */
import {S} from './state.js';
import {STORE} from './store.js';
import {$, esc, escAttr, enableDragReorder} from './dom-utils.js';
import {openForm} from './form.js';

function savePresets(){ STORE.savePresets(S.presets); window.PRESETS=S.presets; }
function saveIdKinds(){ window.ID_KINDS=S.idKinds; STORE.saveIdKinds(S.idKinds); }

export function renderPresets(){
  const w=$('presets');
  /* 관리 진입은 헤더 [설정] 메뉴로 통합(v3.1.0) — 여기는 사용 버튼만 */
  w.innerHTML = S.presets.map((p,i)=>
    `<span class="preset-wrap"><button class="preset" data-p="${i}">＋ ${esc(p.label)}</button><button class="preset-del" data-pdel="${i}" title="이 프리셋 삭제">×</button></span>`
  ).join('');
}

/* 프리셋 관리 모달 — 설정 메뉴(settings-menu.js)에서 연다 */
export function openPresetModal(){ renderPresetList(); clearPresetForm(); renderIdKindList(); $('presetModal').classList.add('on'); }

/* 식별번호 명칭 관리 */
function renderIdKindList(){
  const w=$('idKindList');
  if(!S.idKinds.length){ w.innerHTML='<div class="empty" style="padding:10px">명칭이 없습니다. 아래에서 추가하세요.</div>'; return; }
  w.innerHTML=S.idKinds.map((k,i)=>`<div class="idk-item" data-idk="${escAttr(k)}">
    <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <span class="idk-name">${esc(k)}</span>
    <button class="ps-del" data-idkdel="${i}">삭제</button></div>`).join('');
}
function renderPresetList(){
  const w=$('presetList');
  if(!S.presets.length){ w.innerHTML='<div class="empty">저장된 프리셋이 없습니다.</div>'; return; }
  w.innerHTML=S.presets.map((p,i)=>`<div class="ps-item" data-pid="${esc(p.id)}"><span class="drag-handle" title="드래그하여 순서 변경">⠿</span><div class="ps-body">
    <div class="ps-name">${esc(p.label)}</div><div class="ps-sum">${esc(p.sum||'')}</div>
    ${(p.subs&&p.subs.length)?`<div class="ps-subs">세부: ${p.subs.map(esc).join(' · ')}</div>`:''}
    </div><button class="ps-edit" data-edit="${i}">수정</button><button class="ps-del" data-del="${i}">삭제</button></div>`).join('');
}
let editingPresetId=null;
function loadPresetIntoForm(idx){
  const p=S.presets[idx]; if(!p)return;
  editingPresetId=p.id;
  $('np-label').value=p.label; $('np-sum').value=p.sum||'';
  $('np-subs').innerHTML=''; (p.subs||[]).forEach(t=>addPresetSubRow(t));
  $('np-save').textContent='프리셋 수정 저장';
  $('np-new-head').textContent='✎ 프리셋 수정 중';
  $('np-cancel-edit').style.display='inline-block';
  $('np-label').focus();
}
function addPresetSubRow(val){
  const row=document.createElement('div'); row.className='fsub-row';
  row.innerHTML=`<span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
    <input type="text" placeholder="세부 할 일" value="${escAttr(val||'')}"><button class="rm" title="삭제">×</button>`;
  row.querySelector('.rm').addEventListener('click',()=>row.remove());
  $('np-subs').appendChild(row);
}
function clearPresetForm(){ $('np-label').value=''; $('np-sum').value=''; $('np-subs').innerHTML=''; editingPresetId=null;
  $('np-save').textContent='프리셋 저장'; if($('np-new-head'))$('np-new-head').textContent='＋ 새 프리셋 만들기'; if($('np-cancel-edit'))$('np-cancel-edit').style.display='none'; }

export function initPresets(){
  $('presets').addEventListener('click',e=>{
    const del=e.target.closest('[data-pdel]');
    if(del){ const i=+del.dataset.pdel,p=S.presets[i];
      if(confirm(`프리셋 "${p.label}"을(를) 삭제할까요?`)){ S.presets.splice(i,1); savePresets(); renderPresets(); } return; }
    const b=e.target.closest('.preset'); if(!b)return;
    const p=S.presets[+b.dataset.p]; if(!p)return;
    openForm({memo:p.sum, subs:(p.subs||[]).map(t=>({title:t,mid:''}))});
  });
  $('idKindList').addEventListener('click',e=>{
    const d=e.target.closest('[data-idkdel]'); if(!d)return;
    const i=+d.dataset.idkdel, name=S.idKinds[i];
    const used=S.items.some(it=>(it.ids||[]).some(x=>x.kind===name));
    const msg = used ? `"${name}"은(는) 이미 입력된 업무에서 사용 중입니다.\n삭제해도 기존 업무의 값은 그대로 남고, 앞으로 목록에만 안 나옵니다.\n삭제할까요?`
                     : `명칭 "${name}"을(를) 삭제할까요?`;
    if(confirm(msg)){ S.idKinds.splice(i,1); saveIdKinds(); renderIdKindList(); }
  });
  $('idk-add').addEventListener('click',()=>{
    const v=$('idk-new').value.trim();
    if(!v){ $('idk-new').focus(); return; }
    if(v==='기타'){ alert("'기타'는 항상 자동 포함되므로 추가할 수 없습니다."); return; }
    if(S.idKinds.includes(v)){ alert('이미 있는 명칭입니다.'); return; }
    S.idKinds.push(v); saveIdKinds(); $('idk-new').value=''; renderIdKindList(); $('idk-new').focus();
  });
  $('idk-new').addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();$('idk-add').click();} });
  enableDragReorder($('idKindList'), '.idk-item', '.drag-handle', (container)=>{
    const order=[...container.querySelectorAll('.idk-item')].map(el=>el.dataset.idk);
    S.idKinds.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
    saveIdKinds(); renderIdKindList();
  });
  $('presetClose').addEventListener('click',()=>$('presetModal').classList.remove('on'));
  enableDragReorder($('presetList'), '.ps-item', '.drag-handle', (container)=>{
    const order=[...container.querySelectorAll('.ps-item')].map(el=>el.dataset.pid);
    S.presets.sort((a,b)=>order.indexOf(String(a.id))-order.indexOf(String(b.id)));
    savePresets(); renderPresets(); renderPresetList();
  });
  $('presetList').addEventListener('click',e=>{
    const ed=e.target.closest('.ps-edit');
    if(ed){ loadPresetIntoForm(+ed.dataset.edit); return; }
    const d=e.target.closest('.ps-del'); if(!d)return;
    const p=S.presets[+d.dataset.del];
    if(confirm(`프리셋 "${p.label}"을(를) 삭제할까요?`)){ S.presets.splice(+d.dataset.del,1); savePresets(); renderPresetList(); renderPresets(); if(editingPresetId===p.id)clearPresetForm(); }
  });
  $('np-subadd').addEventListener('click',()=>addPresetSubRow(''));
  enableDragReorder($('np-subs'), '.fsub-row', '.drag-handle'); // np-save가 DOM 순서 그대로 읽으므로 onDrop 콜백 불필요 (fm-subs와 동일 패턴)
  $('np-cancel-edit').addEventListener('click',()=>clearPresetForm());
  $('np-save').addEventListener('click',()=>{
    const label=$('np-label').value.trim(); if(!label){alert('버튼 이름을 입력하세요.');$('np-label').focus();return;}
    const sum=$('np-sum').value.trim();
    const subs=[...$('np-subs').querySelectorAll('input[type=text]')].map(i=>i.value.trim()).filter(Boolean);
    if(editingPresetId){
      const p=S.presets.find(x=>x.id===editingPresetId);
      if(p){ p.label=label; p.sum=sum||label; p.subs=subs; }
    }else{
      S.presets.push({id:'p'+Date.now(), label, sum:sum||label, subs});
    }
    savePresets(); renderPresets(); renderPresetList(); clearPresetForm();
  });
}
