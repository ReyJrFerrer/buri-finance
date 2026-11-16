CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

ALTER TABLE splits ADD COLUMN category_id TEXT REFERENCES categories(id);
CREATE INDEX splits_category ON splits(category_id);

CREATE TABLE budget_periods (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (kind, start_date)
) STRICT;

CREATE TABLE budget_allocations (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  period_id TEXT NOT NULL REFERENCES budget_periods(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  rollover INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (category_id, period_id)
) STRICT;

-- value is basis points for 'percent' (2500 = 25%) and minor units for 'fixed'.
CREATE TABLE allocation_rules (
  id TEXT PRIMARY KEY NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value INTEGER NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
