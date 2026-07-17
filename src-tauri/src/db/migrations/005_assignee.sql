-- v2.5.0 시간·담당자 모드: 담당자(자유 텍스트, ''=본인)
ALTER TABLE items    ADD COLUMN owner TEXT NOT NULL DEFAULT '';
ALTER TABLE subtasks ADD COLUMN owner TEXT NOT NULL DEFAULT '';
