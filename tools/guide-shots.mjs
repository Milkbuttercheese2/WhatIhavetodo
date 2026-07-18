/* =========================================================================
   사용 설명서 스크린샷 일괄 생성 (현행 UI 기준)
   -------------------------------------------------------------------------
   docs/screenshots/*.png 를 현재 src/ UI 로 다시 찍는다. 리눅스 Chromium +
   번들 Pretendard 로 렌더 — 설명서용 예시 이미지이므로 시각 표현이면 충분하다
   (픽셀 정밀 검증은 tools/win-render.mjs 가 실제 Windows 에서 담당).

   실행:  node tools/guide-shots.mjs
   ========================================================================= */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROOT = path.join(REPO, 'src');
const OUT  = path.join(REPO, 'docs', 'screenshots');
fs.mkdirSync(OUT, {recursive: true});

const pw = await import(path.join(REPO, 'node_modules', 'playwright-core', 'index.js'));
const chromium = (pw.default && pw.default.chromium) || pw.chromium;
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  fs.readFile(path.join(ROOT, p), (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(p)] || 'application/octet-stream'});
    res.end(buf);
  });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const url = p => `http://127.0.0.1:${port}/${p}`;

/* 여러 칸·달력을 고루 채우는 예시 데이터 (시각은 in-page 로 now 기준 상대 계산) */
const INIT = `(()=>{
  const now=new Date();
  const at=(dd,hh,mm)=>{const d=new Date(now);d.setDate(d.getDate()+dd);d.setHours(hh,mm,0,0);return d.toISOString();};
  const iso=now.toISOString();
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:''},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const items=[
    mk({id:1,memo:'행정과 전화 — 회의실 예약 대장 정비 요청. 부서별 사용현황 취합 후 회신',staged:true}),
    mk({id:2,memo:'예산 집행 잔액 정리해서 재무팀에 회신하기',f:{received:iso,due:at(0,17,0)},
      contacts:[{who:'김주무관',org:'재무팀',phone:'02-1234-5678'}],
      ids:[{kind:'SR번호',val:'SR-2026-0718-0091'}],
      files:['C:\\\\업무\\\\2026\\\\예산_집행내역_정리.xlsx'],
      subs:[{id:21,title:'집행내역 대사 후 잔액 확정',mid:at(0,16,0),done:false,al:null,owner:''}]}),
    mk({id:3,memo:'감사 대비 증빙자료 스캔·정리',f:{received:iso,due:at(4,10,0)},
      subs:[{id:30,title:'담당 부서 지정 및 협조 요청',mid:at(-1,10,0),done:true,al:null,owner:''},
            {id:31,title:'1차 증빙 취합 상태 점검',mid:at(1,9,30),done:false,al:null,owner:'박주무관'}]}),
    mk({id:4,memo:'차기 사업 계획서 초안 작성',f:{received:iso,due:at(6,15,0)}}),
    mk({id:5,memo:'노후 비품 교체 신청 취합',f:{received:iso,due:at(0,14,0)},
      subs:[{id:51,title:'각 팀 신청서 회신 확인',mid:at(0,13,0),done:false,al:null,owner:'최주무관'}]}),
    mk({id:6,memo:'완료된 주간 실적 보고 제출',done:true,f:{received:iso,due:at(-1,10,0)}}),
    mk({id:7,memo:'매주 월요일 주간회의 자료 준비',recur:{type:'dow',dow:[1],time:'09:00',next:at(3,9,0),paused:false}}),
  ];
  let store={items,fields:null,
    presets:[{label:'계약 변경 통보 접수건 처리',memo:'○○ 사업 계약변경 통보 접수 및 검토',subs:[]},
             {label:'감사 자료 제출',memo:'○○ 감사 대비 증빙자료 정리',subs:[]}],
    idKinds:['입찰공고번호','SR번호'],settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
  const noop=async()=>{};
  window.__TAURI__={
    core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){store.items=(a&&a.items)||store.items;return null;}
      if(c==='save_settings'){store.settings=(a&&a.settings)||store.settings;return null;}
      if(c==='quick_search')return (store.items||[]).filter(function(it){return (it.memo||'').indexOf(a&&a.q||'')>=0;}).map(function(it){return {id:it.id,memo:it.memo,done:!!it.done};});
      if(c==='pick_file_path')return 'C:\\\\업무\\\\2026\\\\회의실_예약대장.hwp';
      return null;}},
    app:{getVersion:async()=>'2.5.10'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,maximize:noop,minimize:noop,toggleMaximize:noop,close:noop,setFocus:noop,label:'main'})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

const browser = await chromium.launch({executablePath: EXEC});

async function open(viewport, page_url='index.html') {
  const page = await browser.newPage({viewport, deviceScaleFactor: 2});
  await page.addInitScript(INIT);
  await page.goto(url(page_url), {waitUntil: 'networkidle'});
  await page.waitForTimeout(1000);
  return page;
}
const shotEl = async (page, sel, file) => { const el = await page.$(sel); await el.screenshot({path: path.join(OUT, file)}); };
const shotPage = (page, file, clip) => page.screenshot({path: path.join(OUT, file), ...(clip?{clip}:{fullPage:false})});

/* ---- 1. board.png : 전체화면 4칸 ------------------------------------- */
{
  const page = await open({width: 1360, height: 900});
  await shotPage(page, 'board.png');
  await page.close();
  console.log('board.png');
}
/* ---- 2. board-owner.png : 전체화면 5칸(시간·담당자) ------------------ */
{
  const page = await open({width: 1360, height: 900});
  await page.click('#settingsBtn'); await page.waitForTimeout(200);
  await page.click('#boardModeBtn'); await page.waitForTimeout(300);
  await page.click('.bm-opt[data-mode="owner"]'); await page.waitForTimeout(300);
  await page.click('#boardModeClose').catch(()=>{}); await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);   // 모달 확실히 닫기
  await shotPage(page, 'board-owner.png');
  await page.close();
  console.log('board-owner.png');
}
/* ---- 3. board-responsive.png : 컴팩트 560 --------------------------- */
{
  const page = await open({width: 560, height: 940});
  await shotPage(page, 'board-responsive.png');
  await page.close();
  console.log('board-responsive.png');
}
/* ---- 4. settings.png : 설정 메뉴 열림 -------------------------------- */
{
  const page = await open({width: 1000, height: 620});
  await page.click('#settingsBtn'); await page.waitForTimeout(400);
  await shotPage(page, 'settings.png', {x:0, y:0, width:1000, height:560});
  await page.close();
  console.log('settings.png');
}
/* ---- 5. form.png : 양식(채워진 상태) -------------------------------- */
{
  const page = await open({width: 1180, height: 900});
  await page.click('.card:has-text("예산 집행")'); await page.waitForTimeout(600);
  await shotEl(page, '#formPanel .fm-inner', 'form.png');
  await page.close();
  console.log('form.png');
}
/* ---- 6. filelink.png : 파일 링크 행(활성/편집) ---------------------- */
{
  const page = await open({width: 1180, height: 900});
  try{
    await page.click('.card:has-text("예산 집행")'); await page.waitForTimeout(600);
    // 이 항목은 파일 1개(활성/링크 상태). 두 번째 행을 추가(mock pick_file_path가 경로 반환)한 뒤
    // 그 행의 토글을 눌러 편집(경로 입력 + 찾기) 상태로 바꿔 두 상태를 한 컷에 보여준다.
    await page.click('#fm-fileadd'); await page.waitForTimeout(300);
    await page.click('#fm-files .ffile-row:last-child .ffile-toggle'); await page.waitForTimeout(250);
  }catch(e){ console.log('filelink prep warn:', e.message); }
  await shotEl(page, '.fm-files-wrap', 'filelink.png');
  await page.close();
  console.log('filelink.png');
}
/* ---- 7. recur.png : 주기 업무 입력·관리 ----------------------------- */
{
  const page = await open({width: 1000, height: 820});
  await page.click('#settingsBtn'); await page.waitForTimeout(200);
  await page.click('#recurManageBtn'); await page.waitForTimeout(500);
  const modal = await page.$('#recurModal .modal, #recurBoxModal .modal, .modal-bg.on .modal');
  if(modal) await modal.screenshot({path: path.join(OUT,'recur.png')});
  else await shotPage(page, 'recur.png');
  await page.close();
  console.log('recur.png');
}
/* ---- 8. calendar.png : 달력 ---------------------------------------- */
{
  const page = await open({width: 1180, height: 860});
  await page.click('.tab[data-view="cal"]'); await page.waitForTimeout(600);
  await shotPage(page, 'calendar.png');
  await page.close();
  console.log('calendar.png');
}
/* ---- 9. alarm.png : 알람창(코드가 만드는 마크업 그대로 재현) --------- */
{
  const page = await open({width: 1180, height: 820});
  await page.evaluate(()=>{
    const now=new Date();
    const fmtT=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    const list=document.getElementById('alarmList');
    if(list) list.innerHTML=
      '<div class="a-item"><b>마감 </b>예산 집행 잔액 정리해서 재무팀에 회신하기<span class="mono">'+fmtT(now)+'</span></div>'+
      '<div class="a-item"><b>점검 </b>각 팀 신청서 회신 확인<span class="mono">'+fmtT(now)+'</span></div>';
    const bg=document.getElementById('alarmBg'); if(bg) bg.classList.add('on');
  });
  await page.waitForTimeout(400);
  await shotPage(page, 'alarm.png');
  await page.close();
  console.log('alarm.png');
}
/* ---- 10. capture-memo.png : 빠른 메모창(620x150 미니창) ------------- */
{
  const page = await open({width: 620, height: 150}, 'capture.html');
  await page.evaluate(()=>{ document.documentElement.style.background='#e9e7e2'; document.body.style.padding='10px'; });
  const inp = await page.$('#cap-inp');
  if(inp){ await inp.click(); await page.keyboard.type('행정과 회의실 예약 대장 정비 요청 — 내일까지 회신', {delay:12}); }
  await page.waitForTimeout(300);
  await shotPage(page, 'capture-memo.png');
  await page.close();
  console.log('capture-memo.png');
}

await browser.close();
server.close();
console.log('\\n모든 설명서 스크린샷 생성 완료 → docs/screenshots/');
