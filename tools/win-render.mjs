/* =========================================================================
   실제 Windows 렌더링 검증 하니스 (v2.5.8)
   -------------------------------------------------------------------------
   목적: 리눅스 개발 환경(폰트 metric·네이티브 컨트롤이 Windows WebView2와
   다름) 대신 **진짜 Windows 러너의 Edge(=WebView2와 동일한 Chromium/Blink
   엔진 + Windows 폰트 스택)** 로 UI를 렌더해 오버플로를 자동 검출한다.
   하드코딩된 픽셀 튜닝 대신 `scrollWidth <= clientWidth` 를 실제 타깃에서
   단언(assert)하는 것이 이 스크립트의 핵심 가치.

   실행:
     - Windows CI:  PW_CHANNEL=msedge node tools/win-render.mjs
                    (러너에 기본 설치된 Edge를 다운로드 없이 실행)
     - 로컬 리눅스: node tools/win-render.mjs
                    (PLAYWRIGHT_CHROMIUM 경로의 Chromium 폴백 — 참고용)

   산출:
     docs/win-render/*.png    각 화면 스크린샷
     docs/win-render/report.md 오버플로 검출 표
   오버플로가 하나라도 있으면 프로세스를 코드 1로 종료해 CI가 빨갛게 뜬다.
   ========================================================================= */
import http from 'http';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROOT = path.join(REPO, 'src');
const OUT  = path.join(REPO, 'docs', 'win-render');
fs.mkdirSync(OUT, {recursive: true});

/* playwright-core 위치: workflow 에서 --no-save 설치되므로 node_modules 에 있다.
   CommonJS default export 이므로 .default 에서 chromium 을 꺼낸다. */
const pw = await import(path.join(REPO, 'node_modules', 'playwright-core', 'index.js'));
const chromium = (pw.default && pw.default.chromium) || pw.chromium;

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

/* __TAURI__ 목 — 일부러 '긴 내용'으로 스트레스: 장문 메모·긴 파일경로·긴 식별번호·
   담당자 여러 명을 넣어 카드 클램프/폼/캘린더/완료가 넘치지 않는지 실측한다. */
const nowIso = new Date().toISOString();
const INIT = `(()=>{
  const iso='${nowIso}';
  const mk=o=>Object.assign({id:1,memo:'',owner:'',f:{received:iso,due:iso},contacts:[],ids:[],subs:[],files:[],done:false,staged:false,al:{},recur:null,recurId:null},o);
  const items=[
    mk({id:1,memo:'행정과 전화 — 회의실 예약 대장 전면 정비 요청. 부서별 사용현황 취합 후 양식 통일하고 회신까지 마무리할 것(장문 메모 줄바꿈·2줄 클램프 확인용 긴 문장).',
      contacts:[{who:'김주무관',org:'행정지원과 총무팀',phone:'02-1234-5678'},{who:'이사무관',org:'예산담당관실',phone:'02-9876-5432'}],
      ids:[{kind:'입찰공고번호',val:'20260718-000123-00'},{kind:'SR번호',val:'SR-2026-0718-9911-XLONG'}],
      subs:[{id:11,title:'각 부서 회의실 사용현황 취합 및 대장 양식 초안 작성(긴 세부 제목 확인)',mid:iso,done:false,al:null,owner:'박주무관'}],
      files:['C:\\\\Users\\\\gong\\\\Documents\\\\2026\\\\회의실\\\\예약대장_최종_v3_진짜최종_수정본.xlsx']}),
    mk({id:2,memo:'예산 집행 잔액 정리 회신',owner:'최주무관',subs:[{id:21,title:'집행내역 대사',mid:iso,done:false,al:null,owner:'최주무관'}]}),
    mk({id:3,memo:'완료된 감사 자료 제출 건 — 긴 완료 항목 제목 줄바꿈 확인용 문장입니다',done:true}),
  ];
  let store={items,fields:null,
    presets:[{label:'계약 변경 통보 접수건 처리',memo:'○○ 사업 계약변경 통보 접수 및 검토',subs:[]}],
    idKinds:['입찰공고번호','SR번호'],settings:{alarmOn:false,boardMode:'time',captureDraft:''},recurDefs:[]};
  const noop=async()=>{};
  window.__TAURI__={
    core:{invoke:async(c,a)=>{
      if(c==='load_all')return store;
      if(c==='save_all'){store.items=(a&&a.items)||store.items;return null;}
      if(c==='save_settings'){store.settings=(a&&a.settings)||store.settings;return null;}
      if(c==='quick_search')return [];
      return null;}},
    app:{getVersion:async()=>'2.5.8'},
    event:{listen:async()=>()=>{},emit:noop,emitTo:noop,once:async()=>()=>{}},
    window:{getCurrentWindow:()=>({hide:noop,show:noop,setSize:noop,maximize:noop,minimize:noop,toggleMaximize:noop,close:noop})}};
  window.Notification={permission:'granted',requestPermission:async()=>'granted'};
})()`;

/* 실행 채널 결정 */
const channel = process.env.PW_CHANNEL || '';
const launchOpts = channel
  ? {channel}                                             // Windows: 시스템 Edge
  : {executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'};
const platformTag = channel ? `edge(${channel})` : 'chromium-linux';

const browser = await chromium.launch(launchOpts);
const findings = [];   // {shot, viewport, kind, sel, over}

/* 한 요소(또는 문서)의 가로 오버플로를 재는 헬퍼: page 안에서 실행 */
async function overflowsIn(page) {
  return await page.evaluate(() => {
    const out = [];
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1)
      out.push({sel: 'document', over: doc.scrollWidth - doc.clientWidth});
    // 화면 밖으로 나가는 입력/버튼/행을 개별 점검
    const vw = window.innerWidth;
    document.querySelectorAll('input,button,select,textarea,.fsub-row,.contact-row,.ps-new-grid,.fm-grid,.card,.bm-opt,.dt-inp').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;          // 숨김
      const cs = getComputedStyle(el);
      // 시각적으로 감춰진 헬퍼(.dt-native 등: 1px·opacity0·aria-hidden)는 오버플로 판정 제외
      const hidden = cs.opacity === '0' || cs.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true' || r.width <= 2 || r.height <= 2;
      if (hidden) return;
      if (r.right > vw + 1) out.push({sel: (el.id ? '#'+el.id : el.className.toString().split(' ')[0]), over: Math.round(r.right - vw)});
      if (el.scrollWidth > el.clientWidth + 1 && (el.tagName==='INPUT'||el.tagName==='TEXTAREA'))
        out.push({sel: (el.id ? '#'+el.id : el.className.toString().split(' ')[0]) + '(clip)', over: el.scrollWidth - el.clientWidth});
    });
    return out;
  });
}

async function capture(name, viewport, prep) {
  const page = await browser.newPage({viewport, deviceScaleFactor: 1});
  await page.addInitScript(INIT);
  await page.goto(`http://127.0.0.1:${port}/index.html`, {waitUntil: 'networkidle'});
  await page.waitForTimeout(900);
  if (prep) { try { await prep(page); } catch (e) { console.log('prep err', name, e.message); } }
  await page.waitForTimeout(500);
  const shot = `${name}-${viewport.width}.png`;
  await page.screenshot({path: path.join(OUT, shot), fullPage: true});
  const over = await overflowsIn(page);
  over.forEach(o => findings.push({shot, viewport: viewport.width, ...o}));
  console.log(`[${platformTag}] ${shot}  overflow=${over.length}`);
  await page.close();
}

/* prep 루틴들 ------------------------------------------------------------ */
const openForm = async page => { await page.click('.card', {timeout: 4000}); await page.waitForTimeout(600); };
const openPreset = async page => {
  await page.click('#settingsBtn'); await page.waitForTimeout(250);
  await page.click('#presetManageBtn'); await page.waitForTimeout(400);
  await page.click('#np-new-head'); await page.waitForTimeout(300);   // '＋ 새 프리셋 만들기' 펼치기
};
const openBoardMode = async page => {
  await page.click('#settingsBtn'); await page.waitForTimeout(250);
  await page.click('#boardModeBtn'); await page.waitForTimeout(400);
};
const openRecur = async page => {
  await page.click('#settingsBtn'); await page.waitForTimeout(250);
  await page.click('#recurManageBtn'); await page.waitForTimeout(400);
};
const ownerMode = async page => {
  await page.click('#settingsBtn'); await page.waitForTimeout(250);
  await page.click('#boardModeBtn'); await page.waitForTimeout(300);
  await page.click('.bm-opt[data-mode="owner"]'); await page.waitForTimeout(300);
  await page.click('#boardModeClose').catch(()=>{}); await page.waitForTimeout(300);
};
const goCal  = async page => { await page.click('.tab[data-view="cal"]');  await page.waitForTimeout(500); };
const goDone = async page => { await page.click('.tab[data-view="done"]'); await page.waitForTimeout(500); };

const COMPACT = {width: 560, height: 840};
const FULL    = {width: 1440, height: 900};

/* board 는 양쪽 폭, 폼·모달은 주로 좁은 폭에서 문제가 났으니 둘 다 찍는다 */
await capture('board',      COMPACT);
await capture('board',      FULL);
await capture('form',       COMPACT, openForm);
await capture('form',       FULL,    openForm);
await capture('preset',     COMPACT, openPreset);
await capture('boardmode',  COMPACT, openBoardMode);
await capture('recur',      COMPACT, openRecur);

await browser.close();
server.close();

/* 리포트 -------------------------------------------------------------- */
let md = `# Windows 렌더링 검증 리포트\n\n`;
md += `- 엔진: \`${platformTag}\`\n- 생성: ${nowIso}\n\n`;
if (!findings.length) {
  md += `✅ 오버플로 없음 — 모든 화면이 뷰포트 안에 들어옴.\n`;
} else {
  md += `⚠️ 가로 오버플로 ${findings.length}건 검출:\n\n`;
  md += `| 스크린샷 | 뷰포트 | 요소 | 초과(px) |\n|---|---|---|---|\n`;
  findings.forEach(f => { md += `| ${f.shot} | ${f.viewport} | \`${f.sel}\` | ${f.over} |\n`; });
}
md += `\n스크린샷: 이 폴더의 \`*.png\`.\n`;
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log('\n' + md);

if (findings.length) { console.error(`FAIL: ${findings.length} overflow finding(s)`); process.exit(1); }
console.log('OK: no overflow');
