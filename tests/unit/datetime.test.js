/* 날짜/시간 파서 — F3(3상태)/F4(존재하지 않는 날짜)/F7(손상 ISO)/F13(24:00 이월) */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  validDate, parseDateStr, parseTimeStr, combineDT,
  DEFAULT_TIME_DUE, DEFAULT_TIME_ZERO,
  isoToDateStr, isoToTimeStr, fmtT, fmtDue,
} from '../../src/datetime.js';

test('parseDateStr: 허용 포맷들', () => {
  const exp = {y:2026, m:7, d:10};
  assert.deepEqual(parseDateStr('2026/07/10'), exp);
  assert.deepEqual(parseDateStr('2026-07-10'), exp);
  assert.deepEqual(parseDateStr('20260710'), exp);
  assert.deepEqual(parseDateStr('2026.07.10'), exp);
  assert.deepEqual(parseDateStr('260710'), exp);      // 6자리 → 2000년대
});

test('parseDateStr/validDate: F4 — 존재하지 않는 날짜 거부', () => {
  assert.equal(parseDateStr('2026/02/31'), null);
  assert.deepEqual(parseDateStr('2024/02/29'), {y:2024, m:2, d:29});  // 윤년 허용
  assert.equal(parseDateStr('2026/13/01'), null);
  assert.equal(parseDateStr(''), null);
  assert.equal(parseDateStr('abc'), null);
  assert.equal(validDate(2026, 2, 31), false);
  assert.equal(validDate(2026, 7, 10), true);
});

test('parseTimeStr: 자릿수별 해석', () => {
  assert.deepEqual(parseTimeStr('9'),    {hh:9,  mm:0,  dayOverflow:false});
  assert.deepEqual(parseTimeStr('930'),  {hh:9,  mm:30, dayOverflow:false});
  assert.deepEqual(parseTimeStr('1830'), {hh:18, mm:30, dayOverflow:false});
  assert.deepEqual(parseTimeStr('18:30'),{hh:18, mm:30, dayOverflow:false});
});

test('parseTimeStr: 24:00은 dayOverflow, 범위 밖은 null', () => {
  assert.deepEqual(parseTimeStr('24:00'), {hh:0, mm:0, dayOverflow:true});
  assert.equal(parseTimeStr('25:00'), null);
  assert.equal(parseTimeStr('18:60'), null);
  assert.equal(parseTimeStr(''), null);
});

test('parseTimeStr: F3 — 숫자 없는 오입력은 00:00으로 삼키지 않고 null', () => {
  assert.equal(parseTimeStr('abc'), null);
  assert.equal(parseTimeStr('저녁'), null);
  assert.equal(parseTimeStr('.'), null);
  assert.equal(parseTimeStr(':'), null);
});

test('combineDT: F3 3상태 — 빈입력 "" / 오입력 null / 정상 ISO', () => {
  assert.equal(combineDT('', ''), '');                       // 미입력 = 정상
  assert.equal(combineDT('', '18:00'), null);                // 시각만 = 오입력
  assert.equal(combineDT('2026/02/31', '18:00'), null);      // 날짜 오입력
  assert.equal(combineDT('2026/07/10', '25:00'), null);      // 시각 오입력 삼키지 않음
  assert.equal(combineDT('2026/07/10', '저녁', DEFAULT_TIME_DUE), null);  // 숫자 없는 시각도 저장 차단
  assert.equal(combineDT('2026/07/10', 'abc'), null);
  const r = combineDT('2026/07/10', '18:30');
  assert.ok(r && !isNaN(new Date(r)));
});

test('combineDT: 시각 미입력 시 기본값 주입 (로컬 시각으로 검증)', () => {
  const due = new Date(combineDT('2026/07/10', '', DEFAULT_TIME_DUE));
  assert.equal(due.getHours(), 18); assert.equal(due.getMinutes(), 0);
  const zero = new Date(combineDT('2026/07/10', ''));        // def 없으면 00:00
  assert.equal(zero.getHours(), 0);
  assert.equal(zero.getDate(), 10);
});

test('combineDT: F13 — 24:00은 다음날 00:00으로 이월', () => {
  const d = new Date(combineDT('2026/07/10', '24:00'));
  assert.equal(d.getDate(), 11);
  assert.equal(d.getHours(), 0); assert.equal(d.getMinutes(), 0);
});

test('isoToDateStr/isoToTimeStr: combineDT 왕복, 손상 입력은 빈 문자열', () => {
  const r = combineDT('2026/07/10', '18:30');
  assert.equal(isoToDateStr(r), '2026/07/10');
  assert.equal(isoToTimeStr(r), '18:30');
  assert.equal(isoToDateStr(''), '');
  assert.equal(isoToDateStr('garbage'), '');
  assert.equal(isoToTimeStr(null), '');
});

const iso = min => new Date(Date.now() + min*60e3).toISOString();
const dayAt = (off, h) => { const d = new Date(); d.setDate(d.getDate()+off); d.setHours(h,0,0,0); return d.toISOString(); };

test('fmtDue: 긴급도는 임박(지남~2시간내)만 강조, 나머지 중립 (v2.5.1)', () => {
  // 지남과 2시간 이내는 같은 '임박(u-imm)' 색
  assert.equal(fmtDue(iso(-5)).cls, 'u-imm');                 // 마감 지남 → 임박색
  assert.ok(!fmtDue(iso(-5)).label.endsWith('지남'));          // '지남' 텍스트는 여전히 안 붙임
  assert.equal(fmtDue(iso(30)).cls, 'u-imm');
  assert.ok(!fmtDue(iso(30)).label.includes('분후'));          // v2.5.1: 남은 시간 꼬리표 제거
  assert.equal(fmtDue(iso(90)).cls, 'u-imm');                 // 2시간 이내 → 임박
  assert.ok(!fmtDue(iso(90)).label.includes('시간후'));
  assert.match(fmtDue(iso(30)).label, /^\d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}$/);   // 날짜·시각만
  // 2시간 초과는 전부 중립 (정오로 고정해 자정 경계 흔들림 방지)
  assert.equal(fmtDue(dayAt(1,12)).cls, '');                  // 내일
  assert.equal(fmtDue(dayAt(2,12)).cls, '');                  // 이틀 뒤
  assert.equal(fmtDue(dayAt(5,12)).cls, '');                  // 그 이후
  // 오늘 늦은 시각: 2시간 초과면 중립, 지금이 늦어 2시간 이내면 u-imm — 둘 다 허용
  assert.ok(['','u-imm'].includes(fmtDue(dayAt(0,23)).cls));
});

test('fmtDue/fmtT: F7 — 손상 ISO는 null', () => {
  assert.equal(fmtDue('garbage'), null);
  assert.equal(fmtDue(''), null);
  assert.equal(fmtT('garbage'), null);
  assert.match(fmtT(iso(0)), /^\d{1,2}\/\d{1,2}\([일월화수목금토]\) \d{2}:\d{2}$/);
});
