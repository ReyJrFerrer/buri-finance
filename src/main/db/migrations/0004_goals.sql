CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  target_date TEXT,
  account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((account_id IS NULL) <> (category_id IS NULL))
) STRICT;
