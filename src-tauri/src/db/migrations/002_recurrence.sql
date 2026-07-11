-- v2.3: recurring schedules ("정기함").
--
-- Recurrence is modeled as a GENERATOR that lives off the board, not as a
-- property of a board item. Each recur_def spawns a normal one-off item onto
-- the board when its next occurrence's day arrives; that spawned item behaves
-- like any other (completing it means it leaves to the done tab), keeping the
-- board's "완료 = 떠남" invariant intact. The spawned item points back at its
-- definition via items.recur_id (a soft link — deleting the definition leaves
-- the already-spawned occurrence alive as a plain item, so no FK cascade).
ALTER TABLE items ADD COLUMN recur_id INTEGER;

CREATE TABLE recur_defs (
  id          INTEGER PRIMARY KEY,        -- caller-supplied id (JS newId())
  memo        TEXT NOT NULL DEFAULT '',   -- memo template for each spawned occurrence
  freq        TEXT NOT NULL,              -- 'daily' | 'weekly' | 'monthly'
  dow         TEXT,                       -- JSON array of weekdays 0..6 (weekly only)
  time_hh     INTEGER NOT NULL DEFAULT 18,
  time_mm     INTEGER NOT NULL DEFAULT 0,
  next_at     TEXT,                       -- ISO datetime of the next occurrence to spawn
  paused      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_items_recur ON items(recur_id);
