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
