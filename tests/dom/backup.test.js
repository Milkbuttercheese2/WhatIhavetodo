/* 백업/복원 — reconcileImported · JSON 복원 분기 전체 · Db/Cancelled · 내보내기 */
import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import {setupEnv} from '../helpers/env.js';

mock.timers.enable({apis:['setTimeout','setInterval']});
const env = setupEnv();
const {S} = await import('../../src/state.js');
const {reconcileImported, initBackup} = await import('../../src/backup.js');
const {initPresets} = await import('../../src/presets.js');
initPresets();     // reconcileImported → renderPresets 경로에 프리셋 초기화 필요
initBackup();

const $ = id => env.document.getElementById(id);
const iso = min => new Date(Date.now() + min*60e3).toISOString();

test('reconcileImported: 4종 소비 + 기타 필터 + save_* 호출 + imported null화', async () => {
  await env.resetS(); S.loaded = true;
  S.imported = {
    fields: [{key:'received'}, {key:'who'}, {key:'커스텀', on:true}],
    presets: [{id:'p1', label:'프리셋1', sum:'요약'}],
    idKinds: ['계약번호', '기타', '', 'SR번호'],
    settings: {alarmOn:false},
  };
  reconcileImported();
  assert.deepEqual(S.idKinds, ['계약번호', 'SR번호']);            // '기타'·빈값 필터
  assert.equal(S.settings.alarmOn, false);
  assert.equal(S.presets[0].label, '프리셋1');
  assert.deepEqual(S.fields.map(f=>f.key), ['received','due','커스텀']);  // 레거시 who 제거
  for(const k of ['fields','presets','idKinds','settings']) assert.equal(S.imported[k], null);
  const cmds = env.invokeCalls.map(c=>c.cmd);
  for(const c of ['save_presets','save_id_kinds','save_settings','save_fields'])
    assert.ok(cmds.includes(c), c+' 호출됨');
  assert.ok($('presets').textContent.includes('프리셋1'));        // 재렌더 확인
});

test('JSON 복원 해피패스: 구형 아이템 마이그레이션 + backup_import 1회 + 상태 교체', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'기존', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  const oldBackup = {
    items: [{id: 2, title:'구형 제목', f:{who:'담당자', due:iso(60)}, subs:[]}],   // v5 이전 형태
  };
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify(oldBackup)}));
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  const bi = env.invokeCalls.filter(c=>c.cmd==='backup_import');
  assert.equal(bi.length, 1);
  const payload = bi[0].args.payload;
  assert.equal(payload.v, 5);
  assert.equal(payload.items[0].memo, '구형 제목');                       // 마이그레이션됨
  assert.deepEqual(payload.items[0].contacts, [{who:'담당자', org:'', phone:''}]);
  assert.ok(Array.isArray(payload.fields) && Array.isArray(payload.presets)); // 빠진 섹션 채움
  assert.equal(S.items.length, 1);
  assert.equal(S.items[0].memo, '구형 제목');                              // 메모리 교체
  assert.equal($('toast-msg').textContent, '백업 1건을 복원했습니다');
});

test('형식 오류 JSON → alert + backup_import 미호출 + 상태 불변', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'보존되어야 함', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: '{"items": "배열아님"}'}));
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.alerts.some(a=>a.includes('형식이 올바르지 않습니다')));
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='backup_import').length, 0);
  assert.equal(S.items[0].memo, '보존되어야 함');
});

test('confirm 거절 → 복원 안 함', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[]})}));
  env.answerConfirm(false);
  $('bkImp').click();
  await env.flush(8);
  assert.equal(env.invokeCalls.filter(c=>c.cmd==='backup_import').length, 0);
});

test('backup_import 실패 → alert + 메모리 상태 불변 (DB 우선 순서)', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'살아남을 데이터', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  env.onInvoke('import_backup_file', () => ({kind:'Json', content: JSON.stringify({items:[{id:9, memo:'새것'}]})}));
  env.onInvoke('backup_import', () => { throw new Error('tx rollback'); });
  env.answerConfirm(true);
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.alerts.some(a=>a.includes('백업 복원 실패')));
  assert.equal(S.items[0].memo, '살아남을 데이터');
});

test('Cancelled → 아무 일도 없음 / Db 거절 → cancel_pending_import / Db 수락 → restart_app', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Cancelled'}));
  $('bkImp').click();
  await env.flush(8);
  assert.equal(env.invokeCalls.filter(c=>c.cmd!=='import_backup_file').length, 0);

  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Db', items:7}));
  env.answerConfirm(false);                       // 덮어쓰기 거절
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='cancel_pending_import'));
  assert.equal($('toast-msg').textContent, '복원을 취소했습니다');

  await env.resetS(); S.loaded = true;
  env.onInvoke('import_backup_file', () => ({kind:'Db', items:7}));
  env.answerConfirm(true, true);                  // 덮어쓰기 + 즉시 재시작
  $('bkImp').click();
  await env.flush(8);
  assert.ok(env.invokeCalls.some(c=>c.cmd==='restart_app'));
});

test('JSON 백업 내보내기: 파일명 패턴 + 내용이 유효한 v5 payload', async () => {
  await env.resetS(); S.loaded = true;
  S.items.push({id:1, memo:'백업될 것', done:false, staged:true, f:{}, contacts:[], ids:[], subs:[], al:{}});
  let captured;
  env.onInvoke('save_text_file', args => { captured = args; return true; });
  $('bkExp').click();
  await env.flush(8);
  assert.match(captured.suggestedName, /^뭐해야했더라_백업_\d{8}\.json$/);
  const parsed = JSON.parse(captured.content);
  assert.equal(parsed.v, 5);
  assert.equal(parsed.items[0].memo, '백업될 것');
  assert.ok(Array.isArray(parsed.fields) && Array.isArray(parsed.idKinds));
  assert.equal($('toast-msg').textContent, '백업 파일을 저장했습니다');
});

test('저장 위치 변경 해피패스: get_data_dir → choose_data_dir → restart_app', async () => {
  await env.resetS(); S.loaded = true;
  env.onInvoke('get_data_dir', () => 'C:\\old\\dir');
  env.onInvoke('choose_data_dir', () => 'C:\\new\\dir');
  env.answerConfirm(true, true);
  $('dataDirBtn').click();
  await env.flush(8);
  const cmds = env.invokeCalls.map(c=>c.cmd);
  assert.deepEqual(cmds, ['get_data_dir', 'choose_data_dir', 'restart_app']);
});
