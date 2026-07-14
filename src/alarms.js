/* =========================================================================
   알람 — 마감 + 세부 점검시각
   ========================================================================= */
import {S} from './state.js';
import {STORE, invoke} from './store.js';
import {$, esc, showToast} from './dom-utils.js';
import {fmtT} from './datetime.js';
import {persist} from './render.js';

function saveSettings(){ window.SETTINGS=S.settings; STORE.saveSettings(S.settings); }

/* AudioContext는 재사용 — 알람마다 새로 만들면 브라우저 엔진의 동시 생성
   상한(약 6개)에 걸려 몇 번 울린 뒤부터 소리가 조용히 죽는다 */
let _audioCtx=null;
function beep(){ try{ const ctx=_audioCtx=_audioCtx||new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==='suspended')ctx.resume(); const g=ctx.createGain(); g.connect(ctx.destination); g.gain.value=.15;
  [0,.28].forEach(t=>{const o=ctx.createOscillator();o.type='sine';o.frequency.value=880;o.connect(g);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+.16);}); }catch{} }
let firedNow=[];
export function checkAlarms(){
  if(!S.settings.alarmOn) return;
  if($('alarmBg').classList.contains('on')) return;   // F5: 모달이 이미 떠 있으면 재알림 금지
  const now=Date.now(); const fire=[];
  const test=(obj,key,iso,label,title)=>{ if(!iso)return; const t=new Date(iso).getTime(); if(isNaN(t)||now<t)return;
    obj.al=obj.al||{}; const st=obj.al[key]; if(st===true)return; if(typeof st==='number'&&now<st)return; fire.push({obj,key,label,title,iso}); };
  S.items.forEach(it=>{ if(it.done)return;
    test(it,'due',(it.f||{}).due,'마감',it.memo||'');
    (it.subs||[]).forEach(s=>{ if(!s.done)test(s,'mid',s.mid,'중간점검',s.title); });
  });
  if(!fire.length)return; firedNow=fire;
  $('alarmList').innerHTML=fire.map(a=>`<div class="a-item"><b>#${a.label}</b>${esc(a.title||'(메모 없음)')}<span class="mono">${fmtT(a.iso)}</span></div>`).join('');
  $('alarmBg').classList.add('on'); beep(); try{window.focus();}catch{} startTitleFlash(fire.length);
  invoke('focus_main_window').catch(()=>{}); // window.focus() can't steal OS focus from another app; this can
  if('Notification'in window&&Notification.permission==='granted'){ fire.forEach(a=>{try{
    const nt=new Notification('뭐하려 했더라 — '+a.label,{body:a.title||'',tag:'wmhh-'+a.key+'-'+a.iso});
    nt.onclick=()=>{ try{window.focus();}catch{} try{nt.close();}catch{} };
  }catch{}}); }
}
let _titleFlash=null, _baseTitle='';
function startTitleFlash(n){
  stopTitleFlash();
  let on=false;
  _titleFlash=setInterval(()=>{ on=!on; document.title = on ? `알림 ${n}건 — 확인하세요` : _baseTitle; },900);
}
function stopTitleFlash(){ if(_titleFlash){ clearInterval(_titleFlash); _titleFlash=null; } document.title=_baseTitle; }
export function renderAlarmToggle(){
  const b=$('alarmToggle'); if(!b)return;
  b.textContent = S.settings.alarmOn ? '알람 켜짐' : '알람 꺼짐';
  b.classList.toggle('alarm-off', !S.settings.alarmOn);
  b.title = S.settings.alarmOn ? '클릭하면 알람을 끕니다' : '클릭하면 알람을 켭니다';
}

export function initAlarms(){
  _baseTitle=document.title;
  // 창을 다시 보면 깜빡임 중지
  window.addEventListener('focus',stopTitleFlash);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) stopTitleFlash(); });
  $('alarmOk').addEventListener('click',()=>{ firedNow.forEach(a=>{a.obj.al=a.obj.al||{};a.obj.al[a.key]=true;}); firedNow=[]; $('alarmBg').classList.remove('on'); stopTitleFlash(); persist(); });
  $('alarmSnooze').addEventListener('click',()=>{ firedNow.forEach(a=>{a.obj.al=a.obj.al||{};a.obj.al[a.key]=Date.now()+6e5;}); firedNow=[]; $('alarmBg').classList.remove('on'); stopTitleFlash(); persist(); });
  $('alarmToggle').addEventListener('click',()=>{
    S.settings.alarmOn=!S.settings.alarmOn; saveSettings(); renderAlarmToggle();
    if(!S.settings.alarmOn){ $('alarmBg').classList.remove('on'); firedNow=[]; stopTitleFlash(); }
    showToast(S.settings.alarmOn?'알람을 켰습니다':'알람을 껐습니다');
  });
  renderAlarmToggle();
  setInterval(checkAlarms,20000); setTimeout(checkAlarms,2500);
}
