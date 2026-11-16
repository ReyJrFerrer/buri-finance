# AGENTS.md

Instructions for coding agents working in this repository. Read this file fully before making changes.

## Project

A local-first personal finance desktop app for macOS and Windows: budgeting, double-entry bookkeeping, investment tracking, and net-worth tracking across the owner's money apps. Data lives on the user's machine. Devices sync peer-to-peer; the project does not run a backend.

**Manual-first ledger.** None of the tracked institutions offer a personal API. The app never logs in to, scrapes, or automates any bank, broker, or wallet. Balances and transactions come from manual entry and file import only.

Institutions to support out of the box (seed these as account presets):

| Institution | Kind | Currency | Notes |
|---|---|---|---|
| GoTyme | Digital bank | PHP | Savings, "Go Save" style sub-accounts |
| MariBank | Digital bank | PHP | Savings |
| GCash | E-wallet | PHP | Wallet plus savings/fund sub-accounts |
| DragonFi | Broker (PH stocks) | PHP | Holdings tracked as quantity x price |
| GoTrade | Broker (US stocks, fractional) | USD | Holdings tracked as quantity x price, converted to PHP |

Base currency is PHP. Users can add any other account manually.

## Stack

- **Shell:** Electron, scaffolded with electron-vite (`src/main`, `src/preload`, `src/renderer`)
- **Language:** TypeScript, `strict: true`, no `any`
- **UI:** React 19+, Astryx design system (`@astryxdesign/core`, `@astryxdesign/theme-neutral`, `@stylexjs/stylex`)
- **Database:** SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher encryption), main process only
- **Validation:** Zod at every IPC boundary
- **Tests:** Vitest for unit tests, Playwright (Electron mode) for end-to-end
- **Packaging:** electron-builder (dmg for macOS, NSIS for Windows)
- **Package manager:** npm

Do not add a dependency without stating why in the change summary. Do not add Tailwind, shadcn/ui, MUI, or any second component or styling library.

## Commands

```bash
npm run dev          # start Electron with hot reload
npm run typecheck    # tsc for main, preload, and renderer
npm run lint         # eslint
npm test             # vitest
npm run build        # production build
npm run build:mac    # package dmg
npm run build:win    # package Windows installer
```

Before declaring a task done, run `npm run typecheck`, `npm run lint`, and `npm test`, and fix what fails. Never delete or skip a failing test to get a green run.

## Directory layout

```
src/
  main/              # Node side: owns the database, sync, files, network
    db/              # connection, migrations, repositories
    ledger/          # posting rules, balances, budgets, goals (pure functions)
    sync/            # change log, clocks, peer transport
    prices/          # market price and FX fetchers
    ipc/             # one handler file per domain
  preload/           # contextBridge: the typed API exposed to the renderer
  renderer/src/      # React app
    features/        # accounts, transactions, budgets, goals, investments, settings
    components/      # shared compositions of Astryx components
    lib/             # formatting, hooks
  shared/            # types and Zod schemas used by all three processes
tests/
```

Business logic belongs in `src/main/ledger` as pure functions with tests. React components display data and send intents; they do not compute balances.

## Process and security rules

These are hard rules.

1. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window.
2. The renderer never imports `electron`, `fs`, `better-sqlite3`, or anything from `src/main`. It talks only through `window.api`, defined in `src/preload`.
3. Every IPC channel has a Zod schema in `src/shared` for its input and its output. Handlers parse input before use. Never expose a generic "run SQL" or "invoke any channel" method.
4. SQL uses prepared statements with bound parameters. No string-built queries.
5. The database key is generated once, wrapped with Electron `safeStorage`, and stored outside the database file. API keys are stored the same way. Never write secrets to logs, the repo, or the renderer.
6. A strict Content Security Policy on the renderer; no remote scripts, no `eval`. External links open in the system browser.
7. The only outbound network calls are price/FX lookups and peer sync, both from the main process.
8. Never log transaction contents, balances, or account names.

## Money rules

- Store amounts as integers in minor units (centavos, cents) in a column named `amount_minor`, with an ISO currency code beside it. Never use floating point for money.
- Store share quantities as integers scaled by 1e8 (`quantity_e8`) to support fractional shares.
- Store prices and FX rates as decimal strings; do arithmetic with a decimal library, then round to minor units once, half-even.
- Never convert currency silently. Converted figures are display values computed from a stored rate with a date; the original amount and currency are always kept.
- Dates are ISO `YYYY-MM-DD` for ledger entries (no time zone) and UTC ISO timestamps for audit fields.

## Data model

Double-entry. Every transaction has two or more splits, and the splits of one transaction sum to zero per currency.

- `accounts`: id, name, type (`asset`, `liability`, `income`, `expense`, `equity`), institution, currency, parent_id, archived
- `transactions`: id, date, payee, memo
- `splits`: id, transaction_id, account_id, amount_minor, currency, category_id
- `categories` and `budget_periods` (weekly or monthly), `budget_allocations` (category, period, amount_minor, rollover flag)
- `allocation_rules`: how incoming money is divided (percentage or fixed amount per category, ordered)
- `goals`: name, target_minor, target_date, linked account or category
- `securities`, `holdings_lots` (account, security, quantity_e8, cost_minor), `prices` (security, date, price), `fx_rates`
- `balance_snapshots`: a dated, user-confirmed balance per account, used for reconciliation

Rules:

- Transfers between the user's own accounts (for example GoTyme to GoTrade) are one transaction with two asset splits. They are never income or expense.
- A cross-currency transfer records both amounts as entered by the user; the implied rate is derived, not assumed.
- All ids are UUIDv7 strings generated on the device. No auto-increment keys (they collide during sync).
- Rows are soft-deleted (`deleted_at`) so deletions can sync.
- Schema changes go through numbered, forward-only migration files in `src/main/db/migrations`. Never edit a migration that has been committed.

## Budgeting behaviour

- A budget period is weekly or monthly; the week start day is a user setting (default Monday).
- When income is recorded, allocation rules propose a split across categories; the user confirms or edits it.
- Monthly amounts viewed weekly are pro-rated by days in the period, with the remainder centavos assigned to the last week so totals match exactly.
- Unspent money rolls over per category when the rollover flag is set.
- Goal progress is the balance of the linked account or category against the target, with a required-per-period figure derived from the target date.

## Sync (peer-to-peer, no project-run server)

Build this last, behind a feature flag. The app must be fully usable on one device with sync off.

- **Change log:** every write also appends a row to `changes` (table, row id, column, value, hybrid logical clock timestamp, device id). Merging is last-write-wins per column by clock, with device id as tie-breaker. Applying the same change twice must be harmless.
- **Transport, in order of preference:** (1) local network discovery, (2) Hyperswarm over its public DHT for devices on different networks. No signalling, relay, or storage server is operated by this project.
- **Pairing:** one device shows a one-time code or QR; the other enters it. Pairing exchanges device public keys. Only paired keys are accepted, and all traffic is end-to-end encrypted.
- **Known limits to respect in the UI:** both devices must be online at the same time, and some networks block direct connections. Show last-synced time and never block local work on sync.
- Transport lives behind an interface in `src/main/sync/transport.ts` so it can be swapped.

## UI rules (Astryx)

- Look and feel target: calm and minimal in the spirit of Notion and Apple apps. Neutral theme, one accent colour, generous spacing, sidebar plus content layout, light and dark mode.
- Use Astryx components first. Before building any UI, look up what exists:
  - `npx astryx search "<what you need>"`
  - `npx astryx docs <topic>` and `npx astryx component <name>`
- Use Astryx theme tokens for colour, spacing, radius, and type. No hard-coded hex values or pixel spacing in feature code.
- When Astryx lacks something, compose it from Astryx primitives in `src/renderer/src/components` and style it with StyleX using theme tokens.
- If Astryx's own agent instructions exist in this repo (a managed block in this file or a separate file created by `astryx init`), follow them for component usage; this file wins on architecture.
- Astryx is in beta. Keep its packages on exact versions in `package.json` and upgrade deliberately with `npx astryx upgrade`.
- Every interactive element is keyboard reachable. Provide a command palette on Cmd/Ctrl+K.
- Amounts are right-aligned, use tabular numerals, and always show the currency. Negative amounts use a minus sign, not colour alone.
- Every list screen has an empty state that tells the user what to add first.

## Working agreement

- Keep changes small and scoped to the task. Do not refactor unrelated code.
- For any change to the ledger, budgets, money maths, or sync merge logic, write or update tests in the same change. Include cases for rounding, zero-sum splits, and cross-currency transfers.
- If a task conflicts with a rule in this file, stop and ask instead of working around it.
- If a decision is not covered here, pick the simpler option and note the choice in the change summary.
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, ...). Do not commit build output, `.env` files, or database files.

## Build order

1. App shell: window, sidebar navigation, theme, encrypted database, migration runner, typed IPC
2. Accounts and manual transactions (double-entry), institution presets, net-worth dashboard
3. Balance check-in screen and reconciliation against snapshots
4. Categories, weekly/monthly budgets, allocation rules, rollover
5. Savings goals
6. Investments: securities, lots, manual prices, then automatic price and FX lookup
7. CSV import with a column-mapping step and duplicate detection
8. Encrypted backup and restore to a file
9. Peer-to-peer sync
10. Auto-update, code signing, installers

Finish and test each step before starting the next.

## Open decisions (ask the owner before choosing)

- Market data provider for US prices and USD/PHP rates, and whether any usable source exists for Philippine stock prices; until decided, prices are entered manually.
- Whether sync is for the owner's own devices only or also for sharing a budget with other people (the second needs per-budget permissions).
- App name, bundle id, and icon.