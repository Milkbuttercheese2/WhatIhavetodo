-- Initial schema. See CLAUDE.md / plan doc for the rationale behind the
-- EAV item_fields table and the single-key alarm columns.

CREATE TABLE items (
  id           INTEGER PRIMARY KEY, -- caller-supplied id (JS newId()), not autoincrement
  memo         TEXT NOT NULL DEFAULT '',
  received_at  TEXT,
  due_at       TEXT,
  staged       INTEGER NOT NULL DEFAULT 0,
  done         INTEGER NOT NULL DEFAULT 0,
  done_at      INTEGER,
  due_alarm    TEXT,               -- encodes al.due ("true"/"false"/snooze-until-ms)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_items_due ON items(due_at);
CREATE INDEX idx_items_staged_done ON items(staged, done);

-- Arbitrary user-defined custom fields beyond received/due (EAV: field set
-- is user-configurable at runtime, so a fixed-column table can't hold it).
CREATE TABLE item_fields (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (item_id, field_key)
);

CREATE TABLE contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  who         TEXT NOT NULL DEFAULT '',
  org         TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_contacts_item ON contacts(item_id);

CREATE TABLE identifiers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT '',
  val         TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_identifiers_item ON identifiers(item_id);

CREATE TABLE subtasks (
  id          INTEGER PRIMARY KEY, -- caller-supplied id (JS newId()), not autoincrement
  item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  mid_at      TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  alarm       TEXT,               -- encodes al.mid, same scheme as items.due_alarm
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subtasks_item ON subtasks(item_id);
CREATE INDEX idx_subtasks_mid ON subtasks(mid_at);

CREATE TABLE fields (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'text',
  on_flag     INTEGER NOT NULL DEFAULT 1,
  builtin     INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE presets (
  id          TEXT PRIMARY KEY, -- caller-supplied id (JS "p"+Date.now())
  label       TEXT NOT NULL,
  sum         TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE preset_subs (
  preset_id   TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_preset_subs_preset ON preset_subs(preset_id);

CREATE TABLE id_kinds (
  kind        TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL -- JSON-encoded value, so booleans/numbers/strings all round-trip
);

-- Seed defaults so a brand-new database already matches what the frontend
-- has always shipped as its fallback (DEFAULT_ID_KINDS / CORE_FIELDS in
-- app.js). This matters because, unlike the old IndexedDB-backed STORE, a
-- SQL SELECT on an empty table returns an empty list rather than "never
-- saved" — without a seed, the frontend can't tell "nothing chosen yet" (use
-- defaults) apart from "explicitly emptied" (respect the empty list), so an
-- unseeded fresh DB would silently present zero identifier-kind options.
INSERT INTO id_kinds (kind, sort_order) VALUES
  ('입찰공고번호', 0),
  ('계약체결번호', 1),
  ('공사관리번호', 2),
  ('SR번호', 3),
  ('국민신문고번호', 4);

INSERT INTO fields (key, label, type, on_flag, builtin, sort_order) VALUES
  ('received', '접수시각', 'datetime', 1, 1, 0),
  ('due', '마감시각', 'datetime', 1, 1, 1);
