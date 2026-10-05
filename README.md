# JS Traders ERP

Implementation of `JS_Traders_ERP_Master_Specification_OPTIMIZED.md` (v2.0).
One Supabase PostgreSQL database per environment, multiple controlled apps.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Foundation: companies, branches, profiles, RBAC (6 roles / 27 permissions), RLS, audit trigger, numbering, security RPCs | ✅ built & applied |
| 2 | Master data: customers + groups/farms, suppliers, products + variants + UOM, categories, brands, warehouses + locations, COA (seeded), bank/cash, payment agents, employees, attachment metadata | ✅ built & applied |
| — | Admin ERP web app (View-first lists, Edit inside View, unsaved-change guard, progressive disclosure, shared dropdown) | ✅ master-data screens |
| 3 | Inventory engine: movement ledger, balances, goods receipts, transfers, adjustments/opening stock, progressive counts, reservations, negative-stock policy, reversal | ✅ built & applied |
| 3b | Physical units/rolls, assembly/disassembly, bundles | next |
| 4+ | Accounting, sales/GDN/pricing, payroll, purchasing, FX/agents, PDC, reconciliation, reports | planned |

## Picking (teams, buzzer, realtime) — 2026-10-03

- **Warehouse Staff** page (`/warehouse-staff`): add staff (login name + password, no email needed), set/shift their warehouses, reset passwords.
  Accounts are created by the `warehouse-staff` edge function. Staff sign in with just their login name (e.g. `ali`).
- **New picking** (Picking page or the sales order's "Picking task" button): per item, quantity from each warehouse
  (defaults to the order's allocation; more can be taken from another warehouse — allocation + reservation move with it),
  then one / several / all staff of each warehouse. One task per warehouse; every chosen picker's phone buzzes.
- **Phone app** (`/m`): tap *Start duty* once (unlocks the loud siren, notifications, keeps screen awake). New work rings until *ACCEPT*.
  Tick "Picked all" or "Short" (quantity found + reason).
- **Shortage**: managers get a chime + alert on any ERP screen; in the task they choose *re-pick* (same/other warehouse, any of its staff),
  *reduce the order*, or *keep on order*. Managers see "seen / not seen yet" per picker, can *Buzz again* or change pickers.
- Everything updates live via Supabase Realtime (`picking_tasks`, `picking_task_lines`, `picking_task_assignees`, `staff_notifications`).
- Test: `tests/sql/picking_teams.sql` (runs as admin / ali / bilal and rolls back).
- If moving staff errors with "function does not exist", run `supabase/RUN_ME_set_staff_warehouses.sql` once in the SQL editor.

## Reports, dashboard and report shortcuts (Stage 11) — 2026-10-05

- **Reports** (`/reports`, registry in `apps/admin-erp/src/reports/registry.tsx`): 41 reports in Sales, Inventory, Purchasing & imports, Finance,
  Cash/bank/cheques, People, Administration. Each is a fixed, permission-checked database function (`rpt_*`, security invoker so RLS applies;
  money columns that need extra rights come back empty) or an existing screen. Generic report screen: period / as-of / party / warehouse /
  bank / account filters, filter rows, sort by any column, group by with subtotals, choose columns, totals, open the document from any row,
  export Excel (.xlsx) / CSV, print / save as PDF, saved reports (personal or shared by an administrator; `saved_reports`).
- Reports include: sales register (with COGS / margin), sales by item, dispatch register, pending orders, receivables / payables ageing
  (buckets always add up to the ledger balance) + open-document detail, customer / supplier / any-party ledger, stock summary (any past date,
  reserved, available, value), low stock, stock movement summary, count variance, purchase register, purchases by item, shipments & ETA,
  landed cost charges, foreign payments, P&L (with previous-period comparison), balance sheet, general ledger, trial balance, cash & bank
  summary, bank book, unreconciled bank items, PDC register, payroll register, employee advances, pay items, assembly labour, audit activity.
- **Dashboard** (`rpt_dashboard`, role-aware): sales month vs last month, profit, receivables (overdue), payables, cash & bank, stock value,
  open orders, shipments; 12-month sales chart; top customers; "needs attention" alerts (cheques due / bounced, overdue invoices, orders to
  approve, picking, low stock, late shipments, unreconciled bank lines).
- **Report shortcuts** (spec §20.1, `report_shortcuts`, Administration → Report shortcuts): configurable buttons on sales invoices, orders,
  quotations, supplier bills, purchase orders, receipts / payments and cheques that open a quick view (or the full report) for the current
  customer / supplier / bank / party. Only declared report parameters can be mapped — no SQL from configuration.
- Tests: `tests/sql/reports_reconcile.sql` (10 reconciliation checks), `tests/unit/reports.test.ts`.

## Post-dated cheques and bank reconciliation (Stage 10) — 2026-10-05

- **Post-dated cheques** (`/pdc`, PDC-): received from customers / issued to suppliers. HELD (in hand / issued; shown as *due* from the cheque date)
  → DEPOSITED → CLEARED, or → BOUNCED → RE-PRESENTED → … → CLEARED; return / cancel; undo deposit / undo clearing; notes. Every change writes `pdc_events`.
  Accounting (normal engine, source `PDC`): received = Dr 1250 PDC Receivable / Cr AR (a RECEIPT, can pay invoices); clear = Dr Bank / Cr 1250.
  Issued = Dr AP / Cr 2150 PDC Payable (a PAYMENT, can pay bills); clear = Dr 2150 / Cr Bank. Bounce reverses the receipt/payment and releases its
  invoice/bill allocations (+ optional bank charges). Duplicate cheque numbers per party are refused.
- **Bank reconciliation** (`/bank-reconciliation`): CSV / .xlsx statement import with column mapping (date formats, debit/credit or signed amount,
  title rows, totals rows skipped). Duplicate-safe: each line gets a key (bank key, else date|amount|reference|description|balance + occurrence);
  re-imports and overlapping statements skip existing lines; a real repeat can be imported as an *authorised duplicate*. Original rows kept (`raw`).
  Matching: suggestions (amount + date window, cheque no. / reference / party raise the score) accepted by the user; manual 1:1, 1:n, n:1, n:n
  (sides must agree); book-only clearing (opening balance, voucher + its reversal); ignore lines with a reason; create the missing receipt / payment /
  expense / transfer / journal from a line (split over several lines) — posted through the normal engine and matched. Finalize: statement balance =
  books − book items not yet on the statement + statement items not yet in the books; a difference needs `bank.reconcile_exception` + a note.
  Finalizing locks the matches and moves `bank_accounts.reconciled_until`; undo restores it. Removed matches keep who / when / why.
  A voucher matched in a reconciliation cannot be reversed until unmatched.
- Permissions: `pdc.manage`, `bank.reconcile` (Administrator, Accountant), `bank.reconcile_exception` (Administrator).
- Tests: `tests/sql/pdc_bank_reconciliation.sql` (25 checks), `tests/unit/statementParse.test.ts`.

## Payments, multi-currency and payment agents (Stage 9) — 2026-10-05

- **Ledger currency**: `journal_lines` now carry `currency`, `fx_amount`, `fx_rate` (the actual rate of that transaction). PKR stays the base — debit/credit are PKR.
  New party type `AGENT` (accounts `AGENT_ADVANCE` / `AGENT_PAYABLE`); agent lines always carry a currency, so each agent sub-account (PKR / CNY / USD …) is a ledger.
- **Foreign bills** credit the supplier in the bill currency at the bill rate.
- **Foreign payments** (`/fx-payments`, FXP-): supplier currency amount × this payment's own rate, paid from a PKR bank, a bank in that currency, or a payment
  agent's sub-account (= agent settlement). Booked to Supplier Advances until applied. Applying to a bill posts the settlement:
  Dr AP (bill rate) / Cr Supplier Advances (payment rate) / difference → 4900 Realized FX Gain/Loss. Unlink / reverse undoes it. Rates are never averaged
  (bill view shows the weighted average for reporting only). Pay Supplier Now and Quick bill work for foreign bills too.
- **Agent accounts** (`/agent-accounts`, AGT-): fund (bank → agent), refund, charges, opening balance; balances per currency (advance or we owe the agent),
  settlements by agent / supplier / shipment / bill, ledger with running foreign + PKR balance.
- **Currency conversions** (`/currency-conversions`, CCV-): supplier balance, agent money or bank money from one currency to another; difference → FX gain/loss.
- **Currency balances & FX** (`/fx`): balances per supplier / agent / bank per currency with carrying rate, currency ledgers, realized FX gain/loss report.
- Test: `tests/sql/fx_payments_agents.sql` (spec §12 example: ¥100,000 @ 40 paid @ 40 / 41 / 42 → PKR 4,090,000, FX loss 90,000).

## Layout

```
apps/admin-erp/        React + Vite + TS + Tailwind admin application
packages/ui/           design tokens (tailwind.preset.js) + shared components
packages/data-access/  Supabase client, access/permissions context, list/record/save hooks
packages/permissions/  permission codes (UI hints only — RLS enforces)
packages/types/        shared types
packages/utilities/    formatting, diff helpers
supabase/migrations/   version-controlled SQL (already applied to project rjdjaujoilcunwtynaze)
```

## Run locally

```bash
npm install
cp apps/admin-erp/.env.example apps/admin-erp/.env   # publishable key only
npm run dev            # http://localhost:5173
npm run build          # typecheck + production build
```

Sign in with an existing Supabase Auth user. The earliest user was bootstrapped as
**Administrator** of company **JS Traders (JST)**. New users: create them in
Supabase → Authentication → Add user / Invite, then assign roles in **Users & Access**.

## Sample data (DEV only)

- `supabase/seed/sample_data.sql` — loads realistic farms, suppliers, products, opening stock, a receipt,
  a transfer, a reservation and an open count. Every record is tagged `[sample]`. Safe to re-run.
- `supabase/seed/reset_sample_data.sql` — removes only `[sample]` records (and their stock history).
  Your own records are kept. Never run on production.

## Inventory rules (Stage 3)

- `stock_movements` is append-only (a trigger blocks edits/deletes). Mistakes are fixed by **Reverse**.
- `stock_balances` is only written by the posting engine; `stock_balance_drift()` must always return 0 rows.
- Clients cannot write inventory tables directly — only through RPCs (`save_*`, `post_stock_document`,
  `reverse_stock_document`, `post_stock_count`, `create_reservation`…).
- Receipts carry quantities only; cost stays `PENDING` until the purchasing cost workflow (Stage 7).
- Adjustments and count approvals need `inventory.post`; warehouse staff can receive and count only.

## Security model (summary)

- Every table has RLS. Reads need `<module>.view`, writes need `<module>.manage`, scoped by `company_id`.
- Warehouses are additionally scoped by `user_warehouse_access` unless the role has `warehouses.all`.
- Salespersons see only assigned customers (`customers.view_assigned`).
- Sensitive columns (customer credit limit/CNIC, supplier bank details, employee CNIC) are
  **column-revoked** from the `authenticated` role and read only through permission-checked RPCs.
- No DELETE policies on master data — records are deactivated, never hard-deleted.
- `created_by/updated_by` are stamped server-side; codes are issued by `next_document_number()` under a row lock.
- Every change is written to `audit_logs` by trigger (with changed fields and request id).

## Previous prototype

The earlier sprint 1–4 tables/functions were moved (not dropped) into schema `legacy_v1`,
which is not exposed via the API. Drop it once you no longer need it:
`drop schema legacy_v1 cascade;`

## Pending manual settings

- Supabase Auth → enable **Leaked password protection** and MFA for administrators.
- Cloudflare R2 bucket + attachment edge function (Stage 13 — metadata table already exists).
