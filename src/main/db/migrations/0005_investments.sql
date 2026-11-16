CREATE TABLE securities (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (symbol, currency)
) STRICT;

CREATE TABLE holdings_lots (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  security_id TEXT NOT NULL REFERENCES securities(id),
  quantity_e8 INTEGER NOT NULL,
  cost_minor INTEGER NOT NULL,
  acquired_date TEXT NOT NULL,
  -- The ledger transaction that paid for the lot, when it was bought with the account's cash.
  transaction_id TEXT REFERENCES transactions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE prices (
  id TEXT PRIMARY KEY NOT NULL,
  security_id TEXT NOT NULL REFERENCES securities(id),
  date TEXT NOT NULL,
  price TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (security_id, date)
) STRICT;

-- One unit of base is worth `rate` units of quote on `date`.
CREATE TABLE fx_rates (
  id TEXT PRIMARY KEY NOT NULL,
  base TEXT NOT NULL,
  quote TEXT NOT NULL,
  date TEXT NOT NULL,
  rate TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (base, quote, date)
) STRICT;

-- Cash spent on holdings moves here at cost; holdings themselves are valued as quantity x price.
INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES
  ('00000000-0000-7000-8000-000000000005', 'Investments', 'equity', 'PHP', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
