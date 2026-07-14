-- v3.1.0: 주기 업무(반복) 정의를 아이템 자체에 저장.
-- JSON 텍스트 ({type:'dow',dow:[..],time:'HH:MM'} | {type:'every',days:N,time:'HH:MM'}).
-- NULL = 반복 없음. 구 recur_defs(v2.3 정기함) 테이블과는 무관한 새 방식 —
-- recur_defs는 데이터 보존용으로만 남아 있다 (append-only 원칙).
ALTER TABLE items ADD COLUMN recur TEXT;
