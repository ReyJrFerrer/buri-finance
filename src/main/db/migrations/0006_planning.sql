-- How often a category is budgeted. Weekly budgets live on weekly budget_periods.
ALTER TABLE categories ADD COLUMN cadence TEXT NOT NULL DEFAULT 'monthly'
  CHECK (cadence IN ('weekly', 'monthly'));

-- The income the user expects in a budget period. An estimate, not tied to any account.
CREATE TABLE income_estimates (
  id TEXT PRIMARY KEY NOT NULL,
  period_id TEXT NOT NULL UNIQUE REFERENCES budget_periods(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

-- A payment due on due_date, then every week or month after it when it repeats.
CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  due_date TEXT NOT NULL,
  repeat TEXT NOT NULL CHECK (repeat IN ('none', 'weekly', 'monthly')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

-- Links one due date of a bill to the expense that paid it.
CREATE TABLE bill_payments (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  due_date TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE INDEX bill_payments_bill ON bill_payments(bill_id, due_date);
