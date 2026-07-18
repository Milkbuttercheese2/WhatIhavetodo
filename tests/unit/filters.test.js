/* filters — haystack 텍스트 수집 · textMatch 술어 */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const {haystack, textMatch} = await import('../../src/filters.js');

const it = {
  memo:'환불 처리 건',
  contacts:[{who:'김담당', org:'모부서', phone:'010-1111-2222'}],
  ids:[{kind:'SR번호', val:'SR-99'}],
  subs:[{title:'담당자 회신'}, {title:'서류 확인'}],
};

test('haystack: 메모·관련인·식별번호·세부 제목을 소문자 한 덩어리로 모음', () => {
  const h = haystack(it);
  for(const frag of ['환불 처리 건','김담당','모부서','010-1111-2222','sr번호','sr-99','담당자 회신','서류 확인'])
    assert.ok(h.includes(frag), `누락: ${frag}`);
  assert.equal(h, h.toLowerCase());     // 소문자 정규화
});

test('haystack: 누락 필드는 빈 값으로 방어 (throw 없음)', () => {
  assert.doesNotThrow(() => haystack({}));
  assert.equal(haystack({}).trim(), '');
});

test('textMatch: 빈 검색어는 전체 통과, 부분일치, 불일치', () => {
  assert.equal(textMatch(it, ''), true);
  assert.equal(textMatch(it, 'sr-99'), true);       // 소문자 needle 부분일치
  assert.equal(textMatch(it, '없는말'), false);
});

test('haystack: 담당자(아이템·세부 owner) 포함 — 이름 검색으로 맡긴 업무 검색 (v2.5.0)', () => {
  const withOwner = Object.assign({}, it, {owner:'박주무관', subs:[{title:'회신', owner:'이담당'}]});
  const h = haystack(withOwner);
  assert.ok(h.includes('박주무관'));
  assert.ok(h.includes('이담당'));
  assert.equal(textMatch(withOwner, '박주무관'), true);
});

test('haystack: 연락처는 숫자만 버전도 포함 — 01011112222로도 검색 (v2.5.1)', () => {
  const h = haystack(it);
  assert.ok(h.includes('01011112222'));
  assert.equal(textMatch(it, '01011112222'), true);
  assert.equal(textMatch(it, '010-1111-2222'), true);   // 기존 하이픈 검색도 유지
});

test('haystack: 파일 링크는 파일명만 포함(경로 폴더명은 제외)', () => {
  const withFiles = Object.assign({}, it, {files:['C:\\비밀폴더\\계약서.HWP','\\\\share\\양식\\보고서.xlsx']});
  const h = haystack(withFiles);
  assert.ok(h.includes('계약서.hwp'));
  assert.ok(h.includes('보고서.xlsx'));
  assert.ok(!h.includes('비밀폴더'));               // 경로 중간 폴더명으로는 안 걸림
  assert.equal(textMatch(withFiles, '계약서'), true);
});
