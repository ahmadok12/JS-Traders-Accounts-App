# JS Traders ERP — Optimized Master Specification
**Version:** 2.0  
**Status:** Production architecture / build specification  
**Purpose:** Single source of truth for implementation. This document is intentionally compact: requirements are stated once and referenced by rule ID instead of repeating the same workflow in multiple sections.

---

# 1. Product Goal

Build a production-ready ERP for JS Traders on **one central PostgreSQL database per environment**, with multiple controlled applications.

Core domains:

- Customers, suppliers, products and variants
- Warehouses, stock, physical units, segments/rolls
- Sales: quotation → SO → picking → GDN → price → invoice
- Purchasing: PO → receipt → cost → bill → payment
- Accounting, ledgers, receivables/payables, PDC
- Multi-currency supplier accounting and payment agents
- Bank reconciliation
- Shipments and landed cost
- Attachments, reports, dashboards, notifications
- Configurable custom fields, forms, workflows and document templates
- RBAC, RLS, audit/history and controlled corrections

**Architecture rule:** six applications are interfaces to one ERP, not six independent systems.

---

# 2. Canonical Architecture

```text
Users
  ↓
Web / Mobile Applications
  ↓
Shared TypeScript packages
  ↓
Secure data-access / server functions
  ↓
Supabase PostgreSQL + Auth + RLS
  ├── Business transactions
  ├── Accounting
  ├── Inventory
  ├── Permissions
  ├── Audit/history
  └── Configuration
  ↓
Cloudflare R2 (private files)
```

Infrastructure:

- GitHub + pull requests + CI/CD
- Supabase: PostgreSQL, Auth, RLS, Realtime, Edge Functions
- Cloudflare R2: ERP attachments
- Development / Staging / Production as separate environments
- Version-controlled SQL migrations

### 2.1 Non-negotiable invariants

1. One source of truth per environment.
2. Security is enforced server-side and by PostgreSQL/RLS; frontend hiding is never security.
3. Inventory is movement-based; `stock_movements` is authoritative.
4. Accounting is journal/transaction-based; balances are derived.
5. Critical financial history is never hard-deleted.
6. Physical and commercial events are separate.
7. Missing financial data is `PENDING/UNKNOWN`, never silently zero.
8. Approved source-document prices/costs are never silently overwritten.
9. Automatic suggestions never remove authorized user control.
10. Corrections use controlled reversal/version/history mechanisms.
11. Core accounting/stock fields are relational, not JSON-only.
12. Business logic is shared; do not duplicate it across applications.
13. Complete and test each bounded subsystem before expanding scope.
14. Design references control visual language, not dashboard/content layout.
15. Major record lists use View-first interaction; Edit lives inside View; destructive actions are separated.
16. Unsaved user input must be protected from accidental navigation, refresh, dialog closure and browser closure.

---

# 3. Applications

## 3.1 Admin / Main ERP

Full authorized access to:

- Dashboard
- Companies/branches
- Users/roles/permissions
- Customers/suppliers/products
- Sales/purchasing/inventory/accounting
- PDC, shipments, reports
- Configuration, custom fields, workflows, templates
- Notifications, attachments, audit

Only authorized administrators may change security/system configuration.

## 3.2 Accountant Portal

Customers/suppliers, invoices/bills, ledgers, receivables/payables, receipts/payments, PDC, bank/cash, journals, COA, reports, reconciliation and attachments.

No advanced security/RLS/role configuration.

## 3.3 Warehouse Manager Portal

Operational-only data:

- Products/variants, warehouses/locations
- SO allocation, reservations, picking, staff assignments
- GDN, stock receipts/transfers/adjustments/counts
- Assembly/disassembly, physical units, bundles
- Operational reports and permitted attachments

Must not receive purchase cost, selling price, margin, customer receivable, supplier payable, bank/accounting data or other restricted financial columns.

## 3.4 Staff Mobile

React Native + Expo. Staff see only assigned tasks and may record physical work, quantity, shortages, completion and permitted photos. They cannot edit the source SO or access financial data.

## 3.5 Owner / Management Mobile

Read-oriented management view: stock, sales, receivables, customer ledger, PDC, shipments/ETA and management reports. Future controlled actions: approve, assign, return, comment.

## 3.6 Salesperson Mobile

Only assigned customers through `customer_salesperson_assignments`; customer history, quotations, SOs, pending GDN/rate tasks, notes, follow-ups and attachments.

---

# 4. Technology & Repository

### Web

React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + React Hook Form + Zod.

### Mobile

React Native + Expo + TypeScript + Expo Router.

### Backend

Supabase PostgreSQL + Auth + RLS + Realtime + Edge Functions.

### Storage

Cloudflare R2 only for ERP attachments. R2 credentials never reach clients.

### Monorepo

```text
apps/
  admin-erp/
  accountant-erp/
  warehouse-manager/
  staff-mobile/
  owner-mobile/
  salesperson-mobile/

packages/
  ui/ types/ auth/ database/ permissions/
  forms/ tables/ documents/ attachments/
  reports/ utilities/ data-access/

supabase/
  migrations/ functions/ seed/

tests/
docs/
```

Prefer a shared package for permissions, API/data access, validation, document state transitions and business calculations.

---

# 5. Performance Architecture

Performance is a design requirement, not a final optimization phase.

## 5.1 Database

- Use proper PK/FK/unique/check constraints.
- Index every high-frequency FK/filter/sort column.
- Composite indexes must follow real query patterns, especially:
  - `(company_id, status)`
  - `(company_id, warehouse_id, product_id, variant_id)`
  - `(customer_id, transaction_date)`
  - `(supplier_id, transaction_date)`
  - `(document_id, status)`
  - `(created_at)` for operational queues where appropriate.
- Avoid indexing every column; indexes have write/storage cost.
- Use `EXPLAIN (ANALYZE, BUFFERS)` for slow queries.
- Keep transactions short.
- Never load an entire ledger, stock table or audit log into the browser.
- Use database views/materialized views only for clearly identified reporting workloads.
- Use `stock_balances` as a maintained/derived read model, never as the authoritative movement history.
- Use summary tables/read models for expensive dashboards rather than recalculating millions of rows on every request.
- Archive/partition very large append-only tables when justified by measured volume, especially audit logs and bank/import histories.

## 5.2 API/data access

- Select only required columns.
- Paginate every large list.
- Prefer cursor/keyset pagination for high-volume tables; offset pagination is acceptable for small/admin lists.
- Debounce search.
- Enforce server-side maximum page size.
- Batch related reads; avoid N+1 queries.
- Use TanStack Query caching, stale times and invalidation rather than repeated identical requests.
- Do not use Realtime for data that does not need realtime behavior.
- Subscribe only to narrow operational queues where realtime materially helps.
- Move heavy report/export jobs to asynchronous server functions/jobs.

## 5.3 Frontend

- Route/code splitting by application/module.
- Lazy-load heavy report/document/editor components.
- Quick contextual reports must use bounded, indexed queries and must not fetch full report datasets unnecessarily.
- Virtualize long tables/lists.
- Keep forms local until submit; avoid global state for transient fields.
- Do not refetch whole pages after every mutation; invalidate only affected queries.
- Use skeleton/loading states and optimistic UI only where rollback is safe.
- Compress/resize images before upload when appropriate.
- Generate PDFs asynchronously for large documents/reports.

## 5.4 Caching rules

Safe to cache aggressively:

- Product metadata
- Units/categories
- Permissions snapshot (short-lived, invalidated on change)
- Dashboard aggregates
- Read-only report results

Do not rely on stale cache for:

- Available stock before posting a stock-affecting transaction
- Invoice posting
- Payment/receipt posting
- PDC state transitions
- Permission changes
- Accounting balances during a write transaction

Critical writes always revalidate authoritative database state.

## 5.5 Performance targets

Initial engineering targets (validate with production-like load; tune after measurement):

- Normal CRUD/list API: p95 < 500 ms
- Common dashboard reads: p95 < 1 s
- Search/autocomplete: p95 < 300 ms
- Posting transaction: p95 < 1 s excluding external storage
- No unbounded query/result
- No UI table that attempts to render thousands of rows without virtualization/pagination

Targets are engineering goals, not correctness guarantees.

---


# 5.5 UI/UX, Design References & Information Density

The ERP must use a **consistent, compact, production-oriented interface** designed to show a high amount of useful information without visual clutter.

## 5.5.1 Design-reference rule

When a user supplies a design reference, the coding agent must treat it as a **visual design-language reference**, not as a template for copying the page/dashboard structure.

Extract and reuse only applicable visual characteristics such as typography, font weights, font sizing relationships, colors, semantic states, borders, radii, shadows, spacing rhythm, input/button styling, table styling, dropdown styling, icon treatment, dialog treatment and hover/focus/selected states.

Do **not** automatically copy from the reference:

- Dashboard layout
- Page structure
- Card arrangement
- Navigation structure
- Content hierarchy
- Sample text/content
- Widgets or KPIs
- Number of fields/columns
- Business workflows
- Component placement when it conflicts with ERP requirements

The ERP information architecture and workflows always take precedence. The reference controls **how the interface looks**; the ERP specification controls **what the interface contains and how it behaves**. If multiple references are supplied, combine compatible visual language into one coherent ERP design system rather than copying any one page.

## 5.5.1A Approved visual theme: soft modern business-app design

The supplied ERP screenshots are an **approved visual-theme reference** for the application. Use this visual language throughout the ERP while preserving the ERP information architecture, business workflows, information-density rules and progressive-disclosure rules defined elsewhere in this specification.

### Visual direction

The overall interface should feel:

- Clean, modern and professional.
- Soft and understated rather than flashy.
- Light neutral background with predominantly white working surfaces.
- Compact enough for serious business use, but not cramped.
- Consistent across desktop ERP, responsive web and mobile applications.
- Visually calm so operational information, status and financial figures remain the focus.

### Typography

Use **Inter** or a visually equivalent modern sans-serif as the primary ERP font.

- Clear font-weight hierarchy: regular → medium → semibold → bold.
- Headings are strong but not oversized.
- Labels and table text remain compact and readable.
- Numeric financial values should use clear tabular/numeric alignment where appropriate.
- Avoid decorative, condensed or overly stylized typography.

### Color language

Use a restrained neutral-first palette:

- Page/background: very light cool gray.
- Cards/dialogs/forms: white.
- Primary text: deep slate/navy/near-black.
- Secondary text: muted slate/gray.
- Borders/dividers: very light gray with low contrast.
- Primary action: dark charcoal/navy/near-black.
- Success: restrained green.
- Warning/pending: restrained amber.
- Error/destructive: restrained red.
- Informational states: restrained blue where useful.

Do not make the ERP look like a colorful dashboard. Semantic colors should communicate state and action, not decorate the interface.

### Surfaces, cards and containers

Use the reference's soft card language:

- White surfaces on a very light neutral page background.
- Subtle 1px borders.
- Soft, low-elevation shadows rather than heavy shadows.
- Rounded corners, generally medium-to-large rather than sharp rectangles.
- Consistent radius tokens across cards, inputs, buttons and dialogs.
- Avoid excessive nested cards; a card should communicate a meaningful grouping.
- Use whitespace to separate major groups, but do not sacrifice ERP information density merely to imitate marketing-site spacing.

### Forms and controls

The supplied invoice reference establishes the preferred form treatment:

- Light neutral input background when idle.
- White/stronger surface on focus.
- Subtle border with a clear but restrained focus state.
- Rounded input/select controls.
- Compact control heights appropriate for desktop ERP work.
- Clear labels above controls.
- Small status badges/chips beside relevant labels or record titles.
- Searchable dropdowns use the shared ERP dropdown component.
- Date fields, currency fields and references use consistent icon/alignment treatment.

### Buttons

Use a small, consistent hierarchy:

1. **Primary:** dark filled button for the main commit/action.
2. **Secondary:** white/light button with subtle border.
3. **Tertiary:** text/icon action for low-risk secondary operations.
4. **Destructive:** restrained red styling, visually separated from routine actions.

Do not create many competing filled buttons in one form.

### Icons

Use one consistent outline icon family throughout the ERP, such as Lucide, Phosphor or Heroicons.

- Consistent stroke weight.
- Small, unobtrusive icons.
- Icons support labels rather than replacing important labels.
- Use icons for View, Edit, Search, Add, Attach, Calendar, Bank, Payment, Inventory, Status and navigation where they improve recognition.

### Dialog/modal treatment

Transaction dialogs may follow the supplied reference's structure:

```text
Soft dimmed backdrop
        ↓
Centered white dialog
        ↓
Compact header with icon + title + status
        ↓
Scrollable form body
        ↓
Sticky/clearly visible action footer
```

Requirements:

- Large enough for practical transaction entry; never squeeze complex ERP forms into an unnecessarily narrow modal.
- Rounded dialog corners and subtle shadow.
- Header separated from body with a light divider.
- Footer separated from body where useful.
- Close button is visible and consistent.
- Body scrolls independently for long forms.
- Primary Save/Submit action remains easy to find.
- Unsaved-change protection from Section 5.5.6 always applies.
- On smaller screens, dialogs may become full-screen sheets/pages rather than preserving desktop dimensions.

### Tables and list screens

Use the same visual language without copying the screenshot's example table:

- White table surface.
- Light header background or subtle header separation.
- Low-contrast row separators.
- Compact but readable rows.
- Strong alignment for dates, quantities, rates and monetary amounts.
- Status badges/chips with restrained semantic colors.
- Hover/selected states are subtle.
- View remains the primary row action.
- Bulk-selection checkboxes may be used where operationally useful.
- Pagination/virtualization is determined by data volume, not visual reference.

### Sidebar and navigation

The reference supports a clean white sidebar with:

- Compact logo/brand area.
- Clearly grouped navigation sections.
- Subtle active-state background.
- Muted inactive navigation.
- Small consistent outline icons.
- Optional collapse behavior.

The exact navigation hierarchy must still follow the ERP module structure and user role; do not copy the reference's menu names or arrangement.

### Dashboard/card usage

The reference's dashboard card/chart treatment may be reused visually, but dashboard content must remain ERP-specific.

Use cards for:

- Important KPIs.
- Short operational queues.
- Alerts/exceptions.
- Small summaries.
- Contextual quick reports.

Do not turn every ERP screen into a card dashboard. Transaction lists, ledgers and warehouse queues should remain information-dense working surfaces where appropriate.

### Design-token requirement

Implement this theme through shared design tokens/components rather than page-specific CSS:

```text
colors
font family / weights / sizes
spacing
control heights
radii
borders
shadows
focus states
status colors
icon sizing
modal widths
```

A change to the shared design system should propagate consistently across applications.

### Theme vs ERP behavior rule

```text
Supplied screenshots
        ↓
Visual language / design system
        ↓
Shared ERP UI components
        ↓
ERP-specific information architecture + workflows
```

Never let the visual reference override:

- Accounting controls.
- Inventory controls.
- Security/RLS.
- View-first interaction.
- Progressive disclosure.
- Required fields.
- Audit/history.
- Unsaved-change protection.
- Accessibility.
- Responsive behavior.
- Performance requirements.

The result should look like a **polished modern business ERP using this visual theme**, not a copy of the reference application.

## 5.5.2 Compact information-dense UI

Default ERP UI must be optimized for information density while remaining readable and accessible.

- Prefer compact business-application typography rather than oversized marketing-style typography.
- Use smaller but readable default font sizes.
- Keep labels, inputs, buttons and table rows compact.
- Minimize unnecessary vertical whitespace.
- Use compact page headers and toolbars.
- Prefer multi-column forms when fields are logically related and the viewport permits it.
- Keep related fields on the same row where readability is not harmed.
- Tables should expose the maximum useful number of columns without excessive scrolling.
- Use sticky table headers where useful.
- Use responsive horizontal scrolling for genuinely wide tables rather than shrinking text below readability.
- Use progressive disclosure for secondary information rather than permanently consuming screen space.
- Preserve keyboard accessibility, focus visibility and adequate click/tap targets.
- Do not use tiny text merely to fit more data; optimize spacing and layout first.

The target is that common ERP screens—lists, stock views, customer ledgers, order screens and operational queues—show **the majority of relevant information on one screen at normal desktop resolution** without unnecessary scrolling.

Define compact shared tokens for body text, labels, table text, input text, button text, headings, control heights, row heights, field gaps, section spacing and dialog padding. Keep these tokens in the shared UI package rather than choosing sizes independently per screen.

## 5.5.3 Forms and fields

- Inputs use a compact, consistent height.
- Labels remain clear without excessive vertical spacing.
- Related fields are grouped logically and placed on the same row where practical.
- Validation messages appear near the affected field without unnecessary layout jumps.
- Required, read-only and disabled states have consistent visual treatment.
- Forms support keyboard navigation and predictable tab order.

## 5.5.4 Dropdowns / selects

All dropdown/select controls must use **one shared ERP dropdown component** and visually follow the approved design reference.

Requirements:

- Same trigger height, border, radius, typography, icon, padding and menu styling throughout the ERP.
- Searchable when the option list can be more than a small fixed set.
- Keyboard searchable/selectable.
- Clear selection where optional.
- Loading, empty and error states.
- Async/server-side search for large datasets such as customers, suppliers and products.
- Debounced remote search.
- Useful secondary information when needed, e.g. customer code or SKU.
- Never load thousands of options merely to make a dropdown searchable; use server-side search/pagination for large datasets.
- Preserve selected values when reopening/editing a record.
- Never silently replace a selected value because search results changed.

Normally searchable: customer, supplier, product/variant, warehouse, location, employee/staff, currency, bank/account, payment agent and salesperson.

## 5.5.5 Record lists: View-first interaction

All major record lists must provide a clear **View** icon/button for each recorded entry.

Standard hierarchy:

```text
View → primary record interaction
Edit → available inside View
Other safe actions → where applicable
Delete/Void → separate destructive-action area
```

Requirements:

- View is visually consistent across modules.
- View opens an appropriate dialog/drawer/detail page.
- View shows key fields, status, authorized history/audit information, related records and available actions.
- **Edit is available inside View** rather than as a prominent list action by default.
- Delete is visually and spatially separated from normal actions.
- Delete uses destructive styling and explicit confirmation.
- Delete must not sit immediately beside common View/Edit/Save actions where an accidental click is plausible.
- Where hard delete is prohibited, provide the controlled action such as Cancel, Void, Archive or Reverse.
- Significant destructive actions may require stronger confirmation.

Recommended pattern:

```text
[Search / Filters]                         [Create]

Record | Status | Date | ... | View / ⋮
                              ↓
                           View Dialog
                              ├─ Edit
                              ├─ Safe Actions
                              └─ More / Destructive Actions
                                           ↓
                                      Delete/Void
                                           ↓
                                   Confirmation Dialog
```

## 5.5.6 Unsaved-change and accidental-loss protection

Any form/dialog/page containing user-entered or modified data must protect against accidental data loss. Once a value changes, track a **dirty/unsaved state**.

If dirty state exists, prevent accidental:

- Dialog/drawer closure
- Browser tab/window closure
- Browser refresh/reload
- SPA route/navigation away
- Switching to another record
- Reset/cancel actions

Use a clear confirmation:

```text
Unsaved changes
You have unsaved changes. Leave without saving?
[Keep Editing] [Discard Changes]
```

For browser/tab close or reload, use the browser's native `beforeunload` protection where supported. For SPA navigation, dialog close, drawer close and record switching, use the application's confirmation dialog.

Additional rules:

- Successful save clears dirty state.
- Explicit discard clears dirty state before closing/navigating.
- Opening a record with no changes must not prompt.
- Auto-save is optional and must never silently overwrite committed data.
- Long forms should preserve local draft state where practical, with explicit recovery.
- Network errors during save must not clear unsaved data.
- Double-clicking Save/Submit must not create duplicate transactions; use idempotency/submit locking.

## 5.5.7 Dialog behavior

- Dialogs have predictable close behavior.
- Escape/click-outside must be disabled or intercepted when unsaved changes exist.
- Important transaction forms use a sufficiently wide dialog or dedicated page rather than a cramped modal.
- Long forms use a scrollable content area with important actions visible/sticky.
- Save/Submit and Cancel have consistent placement.
- Destructive actions remain separated from primary form actions.

## 5.5.8 Responsive behavior

- Desktop ERP screens prioritize information density.
- Tablet/mobile layouts reflow rather than merely scaling desktop UI down.
- Dense tables may become horizontally scrollable or switch to a structured record view on narrow screens.
- Critical fields/actions remain accessible without excessive scrolling.

## 5.5.9 UI acceptance tests

Every major screen must be checked for:

1. Design-reference visual consistency without copying reference content/layout.
2. Compact typography and control sizing.
3. Majority-of-information-on-screen behavior at normal desktop resolution.
4. Consistent searchable dropdown behavior.
5. View action on record lists.
6. Edit inside View.
7. Destructive actions separated from routine actions.
8. Delete/Void confirmation.
9. Unsaved-change protection for dialog, route and browser close/reload.
10. Keyboard/focus accessibility.
11. Responsive behavior.
12. No loss of user-entered data during validation/network errors.
13. Common transaction forms show only essential fields by default.
14. Optional sections expand through clear contextual controls and preserve draft values when collapsed.
15. Existing records automatically expose or clearly indicate populated optional sections.
16. Conditional validation, permissions and lazy loading work correctly for expanded sections.
17. Embedded payment/cost controls use the same accounting/payment engines as standalone workflows.
18. Supplied design references are followed for shared visual language without copying their business content or page structure.
19. Shared visual tokens/components produce consistent typography, surfaces, controls, dialogs, tables, status states and navigation across modules.
20. Visual spacing remains subordinate to the ERP information-density requirement; the interface must not become unnecessarily spacious merely to imitate the reference.

## 5.5.10 Progressive disclosure: simple by default, expandable when needed

The ERP must follow a **simple-by-default / expandable-when-needed** interaction model. A normal transaction should expose only the small set of fields required for the common case. Secondary information, optional actions and advanced controls should be loaded only when the user explicitly enables them.

### Core rule

```text
Default screen
→ Basic fields + common action

Optional checkbox/toggle selected
→ Relevant secondary section expands

Advanced option selected (only where justified)
→ Further fields/options appear
```

This is **progressive disclosure**, not removal of functionality. All underlying data, permissions, validation, audit and accounting rules remain available.

### Design requirements

1. Do not display every possible ERP field on the first screen.
2. Keep the common workflow short and understandable to a non-technical user.
3. Use a small checkbox/toggle or clearly labeled expandable control for optional secondary information when it materially reduces visual complexity.
4. The control label must describe the result, e.g. `Receive Payment Now`, `Show Warehouse Allocation`, `Add Shipping Details`, `Add Labour Details`, `Show Advanced Filters`.
5. Do not use checkboxes merely to hide fields that are actually mandatory for the transaction.
6. Selecting a control must reveal only the fields relevant to that choice; unrelated fields remain hidden.
7. Unchecking an optional section must not silently delete previously entered data. The UI should collapse it and retain the draft values unless the user explicitly chooses to clear them.
8. If expanded data is already stored on an existing record, automatically show that section when the record is opened so information is never hidden from the user.
9. If an expanded section contains required fields, validation applies only when that feature is enabled or the stored data requires it.
10. Conditional fields must be permission-aware; a hidden field must never be used as a security mechanism.
11. Conditional fields and sections must work consistently in Create, Edit, View, conversion dialogs and mobile layouts.
12. Save/Submit must persist the enabled feature and its data atomically with the parent transaction where the feature affects accounting, inventory or document status.
13. Reusable shared components should implement the behavior rather than each screen creating its own custom checkbox logic.
14. Do not create a checkbox for every optional field. Group related fields into a small number of meaningful optional sections.
15. Prefer progressive disclosure for secondary information, not for high-frequency primary information.
16. Advanced sections should remain discoverable through clear labels such as `More details`, `Advanced options`, or a contextual action when a checkbox would be unnatural.
17. Keyboard, accessibility, focus order and mobile touch targets must remain correct when sections expand/collapse.
18. Expansion must not cause destructive layout jumps or lose the user's current cursor/field focus unnecessarily.
19. Conditional sections must preserve unsaved values under the global dirty-state rules.
20. The same rule applies to forms, dialogs, drawers, quick views, reports, filters and mobile screens.

### Expansion levels

Use no more than three practical information levels on a normal transaction screen:

```text
LEVEL 1 — Basic
Common fields required for the ordinary transaction.

LEVEL 2 — Optional
Checkbox/toggle reveals a related secondary section.

LEVEL 3 — Advanced
A separate advanced control reveals specialist/configuration fields only where justified.
```

Do not make users open several nested layers to complete a common task.

### Standard conditional-section component

All such controls should use a shared component with behavior equivalent to:

```text
[ ] Receive Payment Now

when checked:
┌──────────────────────────────────────────┐
│ Receipt Bank       [ Select bank ▼ ]     │
│ Amount             [ _____________ ]     │
│ Payment Date       [ _____________ ]     │
│ Reference          [ _____________ ]     │
│ Attachment         [ Upload ]            │
└──────────────────────────────────────────┘
```

The component should support:

- conditional rendering/expansion
- preserved draft values
- conditional validation
- permission checks
- dirty-state integration
- accessibility labels and keyboard behavior
- mobile reflow
- read-only/View mode
- conversion/document inheritance
- audit/event hooks where the expanded feature creates a business event

### Default-state rules

- New transaction: optional sections are collapsed unless the user's workflow/configuration explicitly defaults them open.
- Existing record containing optional data: the relevant section opens automatically or is clearly indicated as populated.
- Conversion from another document: show optional sections when source data requires user attention.
- Saved/finalized transactions: View mode shows stored information; Edit mode follows normal permissions.
- Role-specific defaults may change visibility but may not bypass required validation or security.

### Screen-by-screen progressive-disclosure matrix

The following controls are the standard starting configuration. Administrators may enable/disable applicable optional sections by role/company/document type, but core accounting, inventory and security invariants remain system-controlled.

| Screen / transaction | Basic default | Optional checkbox / expandable section | Expanded information |
|---|---|---|---|
| Customer | Name, code, contact, basic terms | `Show Additional Customer Details` | Address, tax/registration, group/farm relationship, credit settings, extra contacts, custom fields |
| Supplier | Name, code, contact, currency/basic terms | `Show Supplier Details` | Banking, tax/registration, payment terms, supplier category, import details, custom fields |
| Product / Variant | Name, alias, SKU, unit, active status | `Show Advanced Product Details` | Dimensions, origin, brand, technical attributes, costing/stock controls, custom fields |
| Quotation | Customer, date, items, qty, rate, totals | `Show Additional Details` | Validity, delivery/shipping terms, project/site information, notes, attachments, advanced pricing/tax details |
| Sales Order | Customer, date, items, qty, basic price/status | `Show Warehouse Allocation` | Per-warehouse quantities, availability, reservations and allocation details |
| Sales Order | Same basic fields | `Show Commercial Details` | Payment terms, delivery terms, customer reference, project/site, notes and supporting details |
| GDN | Customer/order, warehouse, items, dispatched qty | `Enter Selling Price Now` | Selling price, currency, commercial notes; otherwise price remains pending and follows the price task workflow |
| GDN | Same basic fields | `Show Dispatch Details` | Driver, vehicle, gate pass, delivery reference, dispatch notes and evidence |
| Sales Invoice | Customer, source, items, qty, rate, totals | `Receive Payment Now` | Receipt bank, amount, payment date, reference and receipt attachment; supports partial payment |
| Sales Invoice | Same basic fields | `Show Additional Invoice Details` | Tax/discount breakdown, customer reference, delivery/payment terms, notes and attachments where configured |
| Purchase Order | Supplier, date, items, qty, basic cost/status | `Show Shipping / Import Details` | Freight, port, destination, shipment reference, expected dates, import/customs-related fields |
| Purchase Order | Same basic fields | `Show Additional Commercial Details` | Payment terms, supplier reference, delivery terms, project/site and notes |
| Goods Receipt | Supplier/PO, warehouse, received items/qty | `Enter Purchase Cost Now` | Cost/currency details; otherwise cost remains `PENDING` and follows cost workflow |
| Goods Receipt | Same basic fields | `Show Receiving Details` | Batch/lot/serial/physical-unit information, receiving notes, shortages/damage, evidence |
| Purchase Bill | Supplier, source, items, qty, rate, totals | `Pay Supplier Now` | Payment bank/account, amount, payment date, reference and payment attachment; supports partial payment/advance rules where applicable |
| Purchase Bill | Same basic fields | `Show Additional Bill Details` | Tax/discount breakdown, supplier reference, terms, import/landed-cost references, notes and attachments |
| Receipt | Party, amount, bank/cash account, date | `Show Allocation Details` | Invoice selection, allocation amounts, unallocated balance and allocation notes |
| Payment | Party, amount, bank/cash account, date | `Show Allocation Details` | Bill selection, allocation amounts, advance/unallocated amount and settlement details |
| PDC | Party, cheque/reference, amount, due date | `Show PDC / Clearing Details` | Deposit, presentation, clearing/bounce/re-present information and linked bank transaction |
| Bank Reconciliation | Account, statement date/range, basic matching | `Show Advanced Matching` | Reference/cheque/date tolerances, one-to-many/many-to-one matching, split tools and exception controls |
| Stock Adjustment | Warehouse, product, qty/reason | `Show Adjustment Details` | Cost/accounting reason, physical evidence, approval/reference and notes |
| Stock Transfer | From, to, product, qty | `Show Transfer Details` | Transport/handler, source/destination locations, reference, notes and evidence |
| Stock Count | Warehouse/location, count scope | `Show Count Details` | Counter assignment, batch/serial/physical-unit details, variance explanation and evidence |
| Assembly / Disassembly | Product/variant, qty, basic components | `Add Labour Details` | Employee assignment, piece-rate quantity/rate, supervisor approval and labour-cost treatment |
| Shipment | Supplier, shipment/container, origin/destination, status | `Show Import / Landed Cost Details` | Commercial invoice, freight, insurance, customs, clearing, port/bank charges and allocation settings |
| Employee | Name, code, position, status | `Show Employment / Payroll Details` | Salary, bank/payment, leave, reporting manager and other restricted HR information according to permission |
| Payroll Run | Period, employees, basic salary result | `Show Variable Earnings & Adjustments` | Bonuses, assembly labour, overtime/other earnings, deductions, advance recovery and leave treatment |
| Customer Statement | Party, date range, balance/transactions | `Show Transaction Details` | Item-level invoice/bill details, bank name for payments, bundle components and additional references |
| Sales / Purchase Reports | Date range, party, basic filters | `Show Advanced Filters` | Custom fields, grouped filters, OR/AND conditions, advanced date/status/warehouse filters |
| Voucher View | Core summary and status | `Show Related Information` | Linked documents, audit/history, attachments, allocations and contextual quick reports |

This matrix is a **default UX specification**, not a requirement to show every listed option on every deployment. Configuration and permissions determine which applicable sections are available.

### Invoice embedded payment

A Sales Invoice must support a small checkbox:

```text
[ ] Receive Payment Now
```

When selected, expand a compact receipt section containing at minimum:

- Receipt/bank account
- Payment amount
- Payment date where applicable
- Payment/reference details
- Receipt attachment upload

The amount may be the full outstanding amount or a valid partial amount. The server must prevent over-allocation unless an explicitly supported overpayment workflow is selected. Invoice, receipt/payment, allocations and accounting entries must be created atomically. If any required part fails, the transaction must not leave a misleading partial posting.

The separate Receipt workflow remains available. The embedded option is a convenience for the common case and must use the same underlying receipt/payment service, validation, permissions, accounting logic and audit trail.

### Purchase embedded payment

Purchasing must provide the corresponding compact control on the appropriate supplier document, normally the Purchase Bill:

```text
[ ] Pay Supplier Now
```

When selected, expand:

- Payment bank/cash account
- Payment amount
- Payment date where applicable
- Payment/reference details
- Payment attachment upload
- Allocation/advance status where relevant

Support full or partial payment. If the supplier payment is greater than the bill amount, the system must explicitly classify the excess as an authorized supplier advance/unallocated payment rather than silently changing the bill. The same payment engine used by the standalone Payment workflow must be reused.

Where a business process receives goods and pays the supplier immediately, an authorized purchasing screen may also expose a compact `Pay Now` control during receipt/bill conversion, but the system must never create a financial payment merely because stock was received.

### Conversion behavior

Progressive-disclosure controls must behave predictably during document conversion:

```text
SO → GDN → Invoice
PO → GRN → Purchase Bill

Source optional data
→ carried forward when semantically valid
→ expanded automatically when user action is required
→ never silently converted into a different business event
```

Example: an Invoice converted from a GDN should preserve an approved source price. It should not automatically receive a payment merely because the source document had an unrelated payment note. A checked `Receive Payment Now` control is an explicit financial action.

### Performance and security

- Collapsed sections should not fetch large secondary datasets unnecessarily.
- Expand-on-demand queries must be bounded, permission-filtered and optimized.
- Do not preload sensitive salary, bank, ledger or large report datasets merely because the section exists.
- Server-side authorization applies equally to expanded content.
- RLS and API responses must prevent access to hidden/restricted data even if a client manually attempts to request it.
- Use lazy loading for expensive related information.

### Configuration data model

A lightweight configuration layer may support fields equivalent to:

```text
conditional_sections
  id
  entity_type
  section_code
  label
  description
  default_state
  enabled
  role_scope
  company_scope
  display_order
  permission_code
```

Field definitions and existing custom-field configuration remain the source for the actual fields. Do not duplicate field definitions merely to make them expandable.

The system must distinguish:

- **UI visibility configuration** — whether a section is normally available/expanded.
- **Business requirement** — whether data is mandatory for the selected workflow/status.
- **Security permission** — whether the user may access the data.

Changing UI configuration must never weaken business validation or security.

# 6. Security Architecture

## 6.1 Authorization chain

```text
Authenticated User
→ Role
→ Permission
→ Company/Branch scope
→ Warehouse scope
→ Customer scope
→ Module/action scope
→ Field/data sensitivity
→ RLS
→ Server-side business rule
→ Database transaction
→ Audit event
```

RLS is mandatory for sensitive tables. Server-side functions must enforce state transitions and financial operations.

## 6.2 Roles

Minimum:

- Administrator
- Owner
- Accountant
- Warehouse Manager
- Warehouse Staff
- Salesperson

Support additional roles without schema redesign.

## 6.3 Sensitive operations

Must be performed through controlled server-side/database transactions:

- Invoice/bill posting
- Payment/receipt posting
- PDC transitions
- Stock adjustment
- Accounting reversal
- Currency conversion
- Permission/security changes
- Reconciliation finalization/undo
- Attachment signed URL generation
- Other state-changing financial operations

## 6.4 Security controls

- MFA for privileged users where supported.
- Strong password/session policies through Auth.
- Short-lived signed URLs for private files.
- Least-privilege service credentials.
- Never expose service-role secrets/client secrets.
- Validate all input with server-side schemas.
- Parameterized queries only.
- Rate-limit login, sensitive mutations, file URL generation and public-facing endpoints.
- Idempotency keys for retry-prone financial/API commands.
- CSRF protection where applicable to cookie-based endpoints.
- Restrict CORS to approved origins.
- Security headers/CSP in web deployment.
- File type, MIME, extension, size and content validation.
- Malware scanning/quarantine for uploaded files where operationally available.
- Never trust client-supplied company/user/role IDs.
- Log security-sensitive events without storing unnecessary secrets.
- Secrets only in environment/secret management, never Git.
- Regular dependency/security scanning.
- Backup + restore tests, not just backup existence.

---

# 7. Database Design

## 7.1 Core tables

### Access/core

```text
companies
branches
profiles
roles
permissions
role_permissions
user_roles
user_warehouse_access
user_customer_access
audit_logs
```

### Master

```text
customers
suppliers
products
product_variants
product_categories
units_of_measure
salespersons
customer_salesperson_assignments
currencies
```

### Inventory

```text
warehouses
warehouse_locations
warehouse_users
stock_movements
stock_balances
stock_transfers
stock_transfer_lines
stock_adjustments
stock_adjustment_lines
stock_counts
stock_count_lines
physical_units
inventory_segments
assemblies
assembly_lines
disassemblies
disassembly_lines
bundles
bundle_components
reservations
```

### Sales

```text
quotations
quotation_lines
sales_orders
sales_order_lines
sales_order_line_warehouse_allocations
gdn
gdn_lines
gdn_line_warehouse_allocations
voucher_assignments
sales_invoices
sales_invoice_lines
commercial_price_tasks
customer_product_prices
```

### Purchasing

```text
purchase_orders
purchase_order_lines
goods_receipts
goods_receipt_lines
supplier_bills
supplier_bill_lines
supplier_payments
purchase_cost_tasks
```

### Accounting

```text
chart_of_accounts
journal_entries
journal_lines
payments
receipts
```

### Employees / HR / Payroll

```text
employees
employee_positions
employee_salary_assignments
employee_bank_accounts
payroll_periods
payroll_runs
payroll_lines
employee_earnings
employee_deductions
employee_bonuses
employee_advances
employee_advance_transactions
employee_payables
leave_types
employee_leave_balances
employee_leave_requests
assembly_labour_rates
employee_assembly_assignments
employee_assembly_earnings
```

### PDC

```text
pdc_records
pdc_events
pdc_allocations
```

### Banking

```text
bank_accounts
bank_statement_imports
bank_statement_lines
bank_reconciliations
bank_matches
```

### Foreign currency/payment agents

```text
supplier_currency_accounts
currency_conversions
currency_conversion_lines
foreign_currency_transactions
supplier_payment_allocations
payment_agents
payment_agent_accounts
payment_agent_transactions
payment_agent_settlements
```

### Shipments/landed cost

```text
shipments
shipment_containers
shipment_documents
shipment_events
landed_costs
landed_cost_lines
landed_cost_allocations
```

### Configuration

```text
system_settings
numbering_sequences
custom_field_definitions
custom_field_options
custom_field_values
document_templates
workflow_definitions
workflow_steps
workflow_transitions
report_definitions
report_shortcuts
dashboard_definitions
notification_rules
notification_templates
notifications
attachments
attachment_categories
```

## 7.2 Data rules

- All business tables include stable UUID primary keys unless a justified alternative is required.
- Business document numbers are separate human-readable identifiers.
- Include `company_id` on tenant-scoped business data.
- Use FK constraints rather than application-only relationships.
- Use `created_at`, `created_by`, `updated_at`, `updated_by` where applicable.
- Posted financial records have immutable posted values; corrections create reversals/controlled amendments.
- Historical documents snapshot customer-facing product/customer terms needed to reproduce the original document.
- Never store core stock/accounting truth only in JSONB.
- Warehouse allocation quantities on Sales Orders/GDNs must use relational child tables; never hard-code warehouse quantity columns.
- Use `numeric`/decimal-safe database types for money and quantities; never floating point for financial values.

---

# 8. Inventory Engine

## 8.1 Source of truth

`stock_movements` is authoritative.

```text
OPENING
PURCHASE_RECEIPT
SALES_GDN
TRANSFER_OUT
TRANSFER_IN
ADJUSTMENT
RETURN
DAMAGE
ASSEMBLY_IN
ASSEMBLY_OUT
DISASSEMBLY_IN
DISASSEMBLY_OUT
```

`stock_balances` is a derived/optimized read model.

## 8.2 Stock identity

Where applicable:

```text
Company + Warehouse + Location + Product + Variant + Tracking identity
```

If a product has variants, stock-affecting transactions must specify the variant.

## 8.3 Negative stock

Negative stock may be allowed during controlled warehouse onboarding or where business policy explicitly permits it. It must be configurable by product/variant/warehouse and clearly reported.

Once a verified physical baseline is established, authorized policy may lock an item against future negative stock.

## 8.4 Progressive physical count

Support:

```text
System Qty Before
Physical Count
Adjustment Qty
System Qty After
Count Status
Counted By
Approved By
```

The warehouse can be used before all opening stock is counted. Each item can remain temporarily negative until counted and reconciled.

Initial count adjustment reasons include:

```text
INITIAL_COUNT
DAMAGE
LOSS
FOUND_STOCK
COUNT_CORRECTION
OPENING_BALANCE
WAREHOUSE_CORRECTION
OTHER
```

## 8.5 Physical units / segments / rolls

Support variable-length/variable-weight stock where required:

- Roll/segment identity
- Length/weight
- Parent/source unit
- Remaining quantity
- Status
- Location
- History

Do not force variable physical stock into a simple integer quantity model.

## 8.6 Assembly/disassembly

Assembly consumes component movements and creates finished-item movements in one atomic transaction.

Disassembly reverses the controlled transformation.

Never create stock without corresponding auditable movement history.

## 8.7 Bundles

Bundles are commercial/grouping structures with component requirements. Stock is consumed from actual components unless the bundle itself is explicitly stocked as an inventory identity.

Support component availability/reservation calculations and bundle weight without double-counting a commercial header.

---

# 9. Sales & Commercial Pricing

## 9.1 Canonical flow

```text
Quotation
→ Sales Order
→ Reservation/Allocation
→ Picking
→ GDN
→ Selling Price Task (if pending)
→ Accountant Review
→ Invoice
→ Receivable
→ Receipt/PDC
```

Physical dispatch must not wait for a commercial price.

## 9.2 Warehouse-specific Sales Order quantities

Sales Orders must support **warehouse-level quantity allocation per Product + Variant**. A Sales Order line is not limited to one warehouse. The user can distribute the requested quantity across any number of currently active/in-scope inventory warehouses.

Example with three warehouses:

```text
Product: Feed Pan
Variant: 16-hole

Warehouse A   [ 50 ]   Available: 80
Warehouse B   [ 30 ]   Available: 42
Warehouse C   [ 20 ]   Available: 15  ← insufficient for 20
--------------------------------------
Total         100
```

### Dynamic warehouse columns

- The Sales Order quantity fields are generated dynamically from the warehouses/inventory locations available to the authorized user/company.
- Adding an active inventory warehouse automatically makes a new warehouse quantity field/column available on applicable Sales Order lines.
- Deactivating/removing an inventory warehouse must not destroy historical allocations; existing documents retain their original warehouse references and quantities.
- The UI must support any practical number of warehouses without hard-coded columns.
- Warehouse quantity fields are per **Product + Variant** line. Variant selection must be explicit where variants affect stock.
- The line may show a computed **Total Quantity** as the sum of warehouse quantities, but the warehouse allocation fields remain the operational source for the order.

### Availability shown during item/variant selection

When the user selects a Product and/or Variant, the system must show current stock availability by warehouse before quantities are entered. At minimum show:

```text
Warehouse | Available | Reserved | Available to Allocate
```

`Available to Allocate` must be calculated from authoritative stock plus existing reservations according to the reservation policy. The availability displayed is a decision aid; the server must revalidate authoritative stock/reservation state when the Sales Order is saved or when stock is reserved.

Requirements:

- Availability must be warehouse-specific and variant-specific where applicable.
- Search/selecting a Product must not require loading the entire inventory table into the browser. Use server-side lookup and a compact availability response.
- Availability should refresh when Product/Variant changes and when relevant reservation/stock changes occur.
- The UI may warn when requested quantity exceeds available quantity, but final enforcement follows the configured negative-stock/reservation policy on the server.
- Do not treat stale displayed availability as authorization to over-allocate stock.

### Warehouse allocation data model

Do not create fixed database columns such as `warehouse_1_qty`, `warehouse_2_qty`, etc. Use a child allocation table, for example:

```text
sales_order_line_warehouse_allocations
---------------------------------------
id
sales_order_line_id
warehouse_id
quantity
reserved_quantity
status
created_at
created_by
updated_at
updated_by
```

Add appropriate unique/quantity constraints so one Sales Order line cannot have duplicate active allocations for the same warehouse unless explicitly versioned.

The design must support future changes to the number of warehouses without schema migration or frontend redesign.

### Reservation and fulfillment

Where reservation is enabled:

```text
Sales Order
→ Warehouse allocations
→ Reservation per warehouse
→ Picking
→ GDN
→ Stock deduction
```

Reservations must never exceed the applicable available quantity unless the configured policy explicitly permits it. Partial allocation and partial delivery are supported.

### GDN warehouse preservation

A GDN must preserve the actual warehouse from which each quantity was physically dispatched. If an SO allocated:

```text
Warehouse A = 50
Warehouse B = 30
```

and the actual dispatch is:

```text
GDN 1: A = 40, B = 20
GDN 2: A = 10, B = 10
```

the system must retain these warehouse-level source allocations on the GDN lines and stock movements. Never reconstruct the source warehouse later from the invoice.

### Invoice quantity consolidation

The invoice is a **commercial/accounting document**, not a warehouse-allocation document. When a Sales Order or GDN is converted to an invoice, the invoice should normally show **one total quantity per Product + Variant**, regardless of how many warehouses supplied it.

Example:

```text
SO:
Warehouse A = 50
Warehouse B = 30
Warehouse C = 20
Total = 100

Invoice:
Feed Pan 16-hole   Qty = 100
```

The invoice must retain hidden/system source links to the originating SO/GDN and their warehouse allocations for audit and traceability, but warehouse columns should not be required on the customer-facing invoice unless a specific document template explicitly requests them.

If the same Product + Variant is consolidated from multiple GDNs into one invoice, the invoice quantity is the sum of the valid source quantities. The system must prevent over-invoicing by validating:

```text
Invoice Qty ≤ uninvoiced eligible GDN/SO source quantity
```

If source lines have different approved selling prices, do not silently average prices merely because quantities can be consolidated. Follow the price-continuity rules in Section 9.4/9.5; separate invoice lines or explicit authorized consolidation may be required.

### Conversion examples

```text
SO
├── Warehouse A: 60
├── Warehouse B: 40
└── Total: 100
        ↓
GDN
├── Warehouse A: 55
└── Warehouse B: 35
        ↓
Invoice
└── Product + Variant: 90
```

The remaining 10 stays undelivered/uninvoiced and remains linked to the Sales Order.

## 9.3 Partial delivery

```text
SO
├── GDN 1
├── GDN 2
└── GDN 3
```

SO remains open until fully delivered or explicitly closed.

## 9.4 Price continuity

Required behavior:

1. Approved SO price carries to GDN/invoice.
2. Approved GDN price carries to invoice.
3. SO → GDN → invoice preserves source linkage.
4. Multiple GDNs can form one invoice without silently averaging different approved prices.
5. A new/changed price requires the configured commercial approval workflow.
6. No price is silently replaced by a newer price.

## 9.5 Customer-specific last charged price

`customer_product_prices` stores approved/posted historical prices by:

```text
Customer + Product + Variant + Currency
```

Keep effective date/history and source document.

When entering a new sale:

```text
1. Use explicit approved source-document price if present.
2. Otherwise suggest the latest applicable approved/posted Customer+Product+Variant price.
3. User may change it only if authorized.
4. Do not auto-overwrite an existing approved price.
```

This is a suggestion, not an accounting truth until approved/posted.

## 9.6 Delayed sales price

```text
GDN
→ STOCK DEDUCTED
→ SELLING_PRICE_PENDING
→ Assign Owner/Salesperson
→ Price Entry
→ Submit
→ Accountant Review
→ Approve/Post
```

`PENDING` ≠ `0`.

Price task retains submission/revision history and return reason.

## 9.7 Delayed purchase cost

```text
Goods Receipt
→ STOCK INCREASED
→ COST_PENDING
→ Assign Owner
→ Cost Entry
→ Submit
→ Accountant Review
→ Approve/Post
```

Warehouse enters physical data only; owner/commercial user enters cost; accountant controls financial posting.

---

# 10. Warehouse Operations

Warehouse Manager can perform:

- Receive stock without purchase cost
- Allocate SOs
- Assign picking work
- Reassign incomplete tasks
- Pick and report shortages
- Create GDN
- Transfer/adjust/count stock
- Assembly/disassembly
- Reservations
- Attach operational evidence

Every reassignment preserves history and previous work/photos.

Example:

```text
Ali: Feed Pipe 150, Clamps 100
→ Reassign remaining work to Hussain
→ Hussain sees only remaining work
→ Original activity remains auditable
```

GDN is the operational dispatch event and reduces stock. Invoice/accounting occurs later.

---

# 11. Accounting Engine

Use:

```text
Chart of Accounts
+ Journal Entries
+ Journal Lines
```

Never manually maintain customer/supplier balances.

Invoice posting:

```text
GDN/Price
→ Review
→ Invoice
→ Receivable
→ Journal Entry
```

Receipt/payment posting must create the appropriate journal transaction and ledger allocation.

All accounting writes are atomic.

---

# 12. Multi-Currency Supplier Accounting

Base currency: PKR. Transaction currencies can include RMB, USD and others.

Currency belongs to the transaction, not permanently to the supplier.

Support:

- Supplier currency history/defaults for convenience only
- Simultaneous multi-currency supplier balances
- Currency conversion vouchers without rewriting history
- Partial/multiple payments with individual actual FX rates
- Settlement currency different from bill currency
- Realized FX gain/loss
- Separate accounting valuation vs actual settlement cost vs import/purchase cost

Example:

```text
Bill: ¥100,000 @ PKR 40 = PKR 4,000,000
Payment 1: ¥40,000 @ 40
Payment 2: ¥30,000 @ 41
Payment 3: ¥30,000 @ 42
Actual settlement = PKR 4,090,000
Realized FX difference = PKR 90,000
```

Never replace individual rates with a weighted average. Weighted average is reporting only:

```text
Σ(foreign amount × actual rate) / Σ(foreign amount)
```

Currency conversion:

```text
RMB liability
→ controlled conversion voucher
→ USD liability
```

Old transactions remain unchanged.

---

# 13. Payment Agents / Money Exchanges

Payment agents are dynamic master data; never hard-code a provider.

Flow:

```text
Company PKR Bank
→ Payment Agent Clearing
→ Foreign Supplier
```

Agent may have PKR/RMB/USD subaccounts.

Agent advance is an asset/clearing balance, not an expense or supplier payment until allocated.

An agent may also become payable if it settles before funding.

Each settlement retains:

```text
payment_agent_id
supplier_id
supplier_bill_id
supplier_payment_id
settlement_date
source_currency
source_amount
supplier_currency
supplier_amount
exchange_rate
base_currency
base_amount
exchange_reference
supplier_bank_reference
funding_account_id
status
```

One advance may fund many supplier settlements. One supplier may use different banks/agents over time.

Required reports:

- Agent register/ledger
- Advance balance
- Payable balance
- Unallocated advances
- Supplier settlements by agent
- FX difference
- PKR funding vs foreign currency settled
- Utilization by supplier/shipment/invoice

---

# 14. PDC

Customer and supplier PDCs support:

```text
RECEIVED/ISSUED
→ HELD
→ DUE
→ DEPOSITED
→ CLEARED
```

Alternative:

```text
DEPOSITED
→ BOUNCED
→ RE-PRESENTED
→ CLEARED
```

Store cheque number, party, bank/branch/account, date, amount/currency, linked invoice/payment, status, deposit/clearance/bounce/re-presentation data, notes and attachments.

Every state change creates a PDC event and audit entry.

---

# 15. Bank Reconciliation

Each bank account has a reconciliation cutoff.

Example:

```text
Last reconciled: 05-Sep
Statement:       01-Sep → 10-Sep
Process:         06-Sep → 10-Sep
```

## 15.1 Import

- Preserve original statement lines.
- Duplicate-safe import using bank/account + statement identity/date/reference/amount or provider-specific unique key.
- Never silently duplicate transactions.

## 15.2 Matching

Automatic matching may use:

- Amount
- Date
- Bank reference
- Cheque number
- Party
- Description
- Transaction type

It is always a suggestion.

User can:

- Accept/change/reject/unmatch
- Search and manually match
- Match one-to-many
- Match many-to-one where valid
- Create receipt/payment/expense/journal/transfer
- Split an accounting entry
- Mark authorized duplicates/ignored lines

## 15.3 Post from reconciliation

Created transactions must use the normal accounting engine:

```text
Bank line
→ Receipt/Payment/Expense/Journal
→ Journal Entry
→ Bank ledger
→ Reconciliation link
```

Never create a separate accounting universe.

## 15.4 Reconciliation history

Store original match, changed match, user, timestamp and reason where required.

Undo/reconciliation changes preserve history.

---

# 16. Purchasing & Landed Cost

## 16.1 Purchasing transaction UX

Purchasing follows the same simple-by-default interaction model as sales:

```text
PO
→ Goods Receipt
→ Cost Pending / Cost Entry
→ Supplier Bill
→ Payable
→ Payment/PDC
```

The ordinary purchasing screen should expose only the fields needed for the common transaction. Optional import/shipping, receiving, costing and payment information is progressively disclosed through the controls defined in Section 5.5.10.

### Purchase Bill — Pay Supplier Now

A Purchase Bill must provide:

```text
[ ] Pay Supplier Now
```

When selected, the bill dialog expands to allow the user to enter the payment bank/cash account, amount, date/reference and upload payment evidence. Partial payments are supported. Any amount not allocated to the bill remains explicitly classified as supplier advance/unallocated payment according to the payment rules; it must not silently disappear or alter the bill amount.

The embedded payment uses the same payment engine as the standalone Payment workflow and creates the bill, payable, payment/allocation and accounting entries atomically.

### Goods Receipt — Enter Cost Now

A Goods Receipt may optionally expose:

```text
[ ] Enter Purchase Cost Now
```

When selected, authorized users can enter the purchase cost/currency information needed by the configured workflow. If not selected, receipt remains `COST_PENDING`; receiving stock must never require a fabricated zero cost.


Purchasing:

```text
PO
→ Goods Receipt
→ Cost Pending
→ Supplier Bill
→ Payable
→ Payment/PDC
```

Supplier currency is transaction-level.

Landed cost is implemented after ordinary purchasing is stable.

Components can include:

- Supplier invoice
- Freight
- Insurance
- Customs
- Clearing
- Port charges
- Bank charges
- Other import costs

Actual customs assessment is entered; ERP does not calculate customs assessment.

Allocation methods:

```text
PURCHASE_AMOUNT
WEIGHT
PERCENTAGE
MANUAL
FUTURE_QUANTITY/FORMULA
```

Support estimated vs actual and configurable treatment:

```text
CAPITALIZE_TO_INVENTORY
EXPENSE
```

Cost adjustments must not rewrite historical GRs.

---

# 16.5. Employees, Payroll & Labour

The ERP must support employees who receive a **fixed monthly salary** plus optional variable earnings such as assembly labour, bonuses and other approved additions. Payroll is part of the ERP accounting system, not a separate spreadsheet process.

## 16.5.1 Employee master

Employee records support:

- Employee code and name
- CNIC/identification where legally required
- Department/position
- Joining date and employment status
- Fixed monthly salary assignment/history
- Bank/payment details
- Reporting manager
- Authorized work areas/warehouse assignments
- Leave policy/balance
- Payroll eligibility/status

Salary changes are effective-dated. Historical payroll must retain the salary/rate actually used for that payroll period.

## 16.5.2 Fixed salary payroll

Employees normally have a fixed monthly salary. Payroll is generated by period:

```text
Payroll Period
→ Load active employees/salary assignments
→ Calculate fixed salary
→ Add approved earnings
→ Add approved bonuses
→ Apply approved deductions/advance recovery
→ Apply approved leave treatment
→ Review
→ Approve
→ Post payroll
→ Employee payable
→ Payment
```

The system must preserve gross earnings, deductions, net payable and each component used to calculate them.

Do not overwrite a finalized payroll calculation when employee master data later changes. Corrections use controlled adjustment/reversal mechanisms.

## 16.5.3 Employee advances

Support employee advances with a separate balance and transaction history:

```text
Advance Granted
→ Employee Receivable/Advance Balance
→ Payroll Recovery(s) / Direct Repayment
→ Balance Reduced
```

Each advance supports:

- Date
- Amount/currency
- Reason/reference
- Approved by
- Recovery schedule or manual recovery
- Amount recovered
- Remaining balance
- Linked payroll/payment transactions

An employee advance is not immediately an expense. It remains an employee receivable/advance until recovered or otherwise authorized for write-off/adjustment.

Payroll must support configurable recovery amounts without exceeding the outstanding advance unless an explicit over-recovery correction is authorized.

## 16.5.4 Employee payables

Employee payable is the net amount owed to an employee after payroll/approved transactions. It may include:

- Fixed salary
- Assembly labour earnings
- Bonus
- Other approved earnings
- Less advance recovery
- Less approved deductions

Support payment allocation against employee payable so outstanding balances remain auditable.

## 16.5.5 Bonuses and other earnings

Support configurable earning types rather than hard-coding only one bonus type:

```text
SALARY
ASSEMBLY_LABOUR
BONUS
OVERTIME/OTHER_APPROVED_EARNING
```

Each earning has amount, period/date, source/reference, approval status and audit history.

Bonuses must be approved before payroll posting.

## 16.5.6 Leave management

Support configurable leave types and balances:

- Paid leave
- Unpaid leave
- Other company-defined leave types

Leave requests follow:

```text
Requested → Approved/Rejected → Applied to Payroll
```

Leave balances are maintained by employee and leave type. Payroll treatment is configurable by leave type/company policy. The system must distinguish an approved leave request from a payroll-applied deduction.

## 16.5.7 Assembly labour / piece-rate earnings

Some employees may be assigned to assemble products such as **evaporative coolers or exhaust fans**. Their normal fixed salary continues unchanged, while approved assembly work creates an **additional per-item labour earning**.

Do not convert the employee to a fully piece-rate employee. Model assembly labour as a separate variable earning component.

Example:

```text
Employee: Ali
Fixed salary: PKR 45,000/month

Cooler assembly rate: PKR 500/item
Approved quantity assembled: 20
Assembly earning: PKR 10,000

Gross before other adjustments = PKR 55,000
```

Support:

- Product/variant-specific labour rate
- Effective-dated labour rate history
- Employee-specific rate override where authorized
- Assembly job/task assignment
- Assigned quantity
- Completed quantity
- Rejected/failed quantity where applicable
- Approved payable quantity
- Rate per item
- Calculated labour earning
- Source assembly record/job
- Supervisor/manager approval
- Payroll period linkage

Only **approved payable quantity** generates payroll earnings. The same physical assembly work must not be paid twice.

Preferred flow:

```text
Assembly Job
→ Assign Employee(s)
→ Record Completed Quantity
→ Supervisor Approval
→ Employee Assembly Earning
→ Payroll Period
→ Payroll Review
→ Post
```

If multiple employees work on the same assembly job, support controlled allocation of completed units among employees. The total approved employee quantity must not exceed the quantity actually produced/approved by the assembly transaction unless an authorized exception is recorded.

## 16.5.8 Labour-rate configuration

`assembly_labour_rates` is dynamic master data. A rate may be defined by:

```text
Product / Variant
+ Employee or Employee Group (optional)
+ Effective From/To
+ Rate per Unit
+ Currency
+ Approval Status
```

The system must preserve the rate used by each completed earning. Later rate changes must not rewrite historical payroll.

## 16.5.9 Accounting treatment

Payroll posting must use the accounting engine. At minimum:

```text
Payroll Expense / Applicable Labour Cost
        Cr Employee Payable
```

On payment:

```text
Employee Payable
        Cr Bank/Cash
```

Assembly labour may be configured as an inventory/production cost component where the business policy requires labour to be capitalized into assembled inventory; otherwise it may be expensed. The selected treatment must be explicit, controlled and auditable.

Advance recovery reduces the employee receivable/advance and employee payable appropriately; it must not be incorrectly booked as new income.

## 16.5.10 Payroll security

Payroll is sensitive financial/employee data.

- Warehouse users must not see salary, bonuses, advances, payroll or employee payable amounts unless explicitly authorized.
- Staff mobile users see only their own permitted work/payroll information.
- Payroll administrators/accountants see only authorized employee/payroll data.
- Salary/rate changes require authorization and audit history.
- Employee bank/payment details require restricted access.
- RLS and server-side authorization must protect payroll data; frontend hiding is not sufficient.

## 16.5.11 Payroll reports

Provide:

- Payroll register
- Employee salary history
- Gross/net salary report
- Employee payable aging/balance
- Advance register and outstanding advances
- Bonus report
- Leave register and balances
- Assembly labour quantity/rate/earning report
- Labour cost by product/variant/assembly job
- Payroll journal/posting report
- Employee payment report

# 17. Shipments

```text
Supplier
→ Purchase Order
→ Shipment
   ├─ Containers
   ├─ Commercial Invoice
   ├─ Packing List
   ├─ B/L
   ├─ COO
   └─ Tracking
→ Destination
→ Goods Receipt
→ Warehouse
```

Track:

- Shipment/container number
- B/L
- Origin/destination
- Supplier/forwarder
- ETD/ETA
- Status
- Documents/events

Statuses:

```text
BOOKED
LOADED
DEPARTED
TRANSSHIPMENT
ARRIVED_PORT
CUSTOMS
RELEASED
DELIVERED
```

External tracking integrations must run server-side; mobile consumes controlled/cached ERP data.

---

# 18. Attachments

Files live in private Cloudflare R2. PostgreSQL stores metadata.

```text
attachments
attachment_categories
```

Metadata:

```text
id
entity_type
entity_id
file_name
original_file_name
mime_type
file_size
r2_bucket
r2_object_key
category
description
upload_status
uploaded_by
uploaded_at
deleted_at
deleted_by
```

Object key example:

```text
production/companies/{company_id}/gdn/{gdn_id}/{uuid}.pdf
```

Flow:

```text
User
→ Permission check
→ Attachment service
→ Signed upload/download URL
→ R2
```

Support upload/complete/list/download/delete/restore with authorization and audit.

---

# 19. Configurable Fields, Documents & Workflows

## 19.1 Custom fields

Use:

```text
custom_field_definitions
custom_field_options
custom_field_values
```

Types:

```text
text, long_text, number, decimal, currency, percentage,
date, datetime, checkbox, dropdown, multi_select,
reference, file, image, formula
```

Values must be structured/queryable enough for filters, reports and dashboards.

Do not create arbitrary SQL columns for every custom field. Do not hide core accounting/stock values in JSON.

## 19.2 Dynamic documents

One document engine supports:

Quotation, SO, GDN, Invoice, PO, Receipt, Payment Voucher, PDC and other vouchers.

Configurable:

- Logo/header
- Customer/document information
- Item columns
- Tax/totals
- Payment information
- Notes/terms
- Signature/footer

Finalized documents must reproduce historical customer-facing values.

## 19.3 Workflow engine

```text
workflow_definitions
workflow_steps
workflow_transitions
```

Support configurable statuses, required permissions/fields, approval limits, notifications and audit events.

Use workflows for price/cost tasks, approvals, picking, GDN, invoices, purchase bills, adjustments, transfers, payments and reconciliation exceptions.

---

# 20. Reports & Dashboards

Initial operational reports:

- Stock summary/ledger/movement/availability
- Availability after reservations
- Low/critical stock
- Stock count variance
- Progressive onboarding
- Pending picking/picking performance
- Assembly/disassembly/incomplete units
- Bundle component requirements
- Order weight
- Pending/partial orders
- Customer reservations

Financial reports:

- Sales/purchase register
- Customer/supplier ledger
- Receivable/payable aging
- PDC register
- Cash/bank book
- Trial balance
- P&L
- Balance sheet
- FX/payment-agent reports
- Bank reconciliation reports
- Payroll register and employee payable report
- Employee advances and recovery report
- Bonuses and leave report
- Assembly labour quantity/rate/earning report
- Labour cost by product/variant/assembly job

Dashboard widgets:

```text
KPI / chart / table / list / alert / progress
```

Report builder supports data source, fields, filters, grouping, sorting, calculated fields, date ranges and saved reports; exports should be asynchronous for large datasets.

### 20.1 Contextual Quick Reports & Report Shortcuts

The ERP must provide a reusable **contextual report shortcut engine** so users can see relevant information without leaving the voucher they are working on. Shortcuts may open either a compact quick view or the complete report.

Examples:
- **Sales Invoice / Sales Order** → Customer Ledger, Customer Payments, Last Invoices, Recent Invoices, Customer-specific last selling price, Last sold quantity, Product sales history.
- **Customer context** → Ledger, Receipts/Payments, Outstanding balance, Recent invoices, Aging, Sales history.
- **Product/variant context** → Last selling price to this customer, last sold quantity/date, recent sales, stock availability, purchase cost history, recent purchase price.
- **Supplier context** → Supplier ledger, payments, recent bills, purchase history and outstanding payable.
- **Bank Payment/Receipt context** → Bank ledger, recent transactions, unreconciled items, party ledger and related payment history.
- **Purchase/GRN/Bill context** → Supplier history, item purchase history, last cost and stock position.
- **PDC context** → Customer/supplier ledger, previous cheques and outstanding balance.

#### Shortcut behavior

- Shortcuts are **configuration-driven**, not hard-coded into individual voucher screens.
- An administrator/authorized user can add, remove, reorder, enable/disable and rename shortcuts for each voucher/context.
- A shortcut can target any permitted report definition and choose `QUICK_VIEW` or `FULL_REPORT`.
- The system automatically passes the current context, such as `customer_id`, `product_id`, `variant_id`, `supplier_id`, `bank_account_id`, `voucher_id`, date range or other supported identifiers, into the report.
- Context parameters must be defined explicitly; arbitrary query execution is never allowed.
- The same report definition may be reused from many vouchers and contexts.
- Shortcuts must respect the user's permissions, company scope, RLS and report-level access.
- If the required context is unavailable, the shortcut is hidden/disabled rather than producing misleading results.
- Quick views should show only the fields needed for the immediate decision, with a **View Full Report** action.
- Quick views should support compact tables, totals, recent records and essential filters without loading the full report builder.
- Large or expensive reports should load asynchronously and must not block voucher entry.
- Shortcut clicks must be read-only unless a separate explicitly authorized action is provided.
- The system should support opening the report in a side panel/modal, new route/tab, or full report page according to configuration.
- The current voucher remains intact; opening/closing a report must not lose unsaved voucher data.

#### Dynamic shortcut configuration

Example configuration concept:

```text
Voucher: SALES_INVOICE
  CUSTOMER context:
    Customer Ledger       → QUICK_VIEW
    Customer Payments     → QUICK_VIEW
    Recent Invoices       → QUICK_VIEW
  PRODUCT_LINE context:
    Last Selling Price    → QUICK_VIEW
    Sales History         → FULL_REPORT
    Stock Availability    → QUICK_VIEW

Voucher: BANK_PAYMENT
  BANK_ACCOUNT context:
    Bank Ledger            → QUICK_VIEW
    Unreconciled Items     → QUICK_VIEW
  PARTY context:
    Party Ledger           → QUICK_VIEW
```

The actual available shortcut list must come from configuration and permissions; the UI must not assume a fixed number or fixed set of report buttons.

#### Report shortcut data model

`report_shortcuts` should support at minimum:

```text
id
report_definition_id
voucher_type
context_type
label
view_mode              -- QUICK_VIEW / FULL_REPORT
parameter_mapping      -- controlled JSON mapping from current context to report parameters
placement              -- HEADER / CUSTOMER / PRODUCT / LINE / ACTIONS / MORE
sort_order
enabled
required_permission
created_by
updated_by
created_at
updated_at
```

Use controlled enums/registries for `voucher_type`, `context_type`, `view_mode` and `placement`; do not create unrestricted dynamic SQL from configuration.

#### Performance

- Quick reports must use optimized indexed queries/read models where appropriate.
- Do not load complete ledgers or large report datasets when the quick view only needs the latest few records/totals.
- Use bounded result sets such as last 5/10/20 records where configured.
- Cache only data that is safe to cache and invalidate appropriately after relevant posting changes.
- The shortcut framework must remain lightweight enough to use repeatedly during voucher entry.

---

# 21. Notifications

Tables:

```text
notifications
notification_rules
notification_templates
```

Initial triggers:

- PDC due/bounced
- GDN awaiting rate
- Purchase cost pending
- Invoice awaiting posting
- Approval pending
- Low stock
- Transfer pending
- Shipment ETA
- Payment received
- Payroll pending approval/posting
- Employee advance due/recovery pending
- Leave request pending approval
- Assembly labour awaiting approval

Start with in-app notifications; add email/WhatsApp/SMS through controlled integrations later.

---

# 22. API & Transaction Rules

Every mutation must follow:

```text
Validate input
→ Authorize
→ RLS/scope check
→ Revalidate current state
→ Execute atomic DB transaction
→ Create audit/history
→ Return canonical result
→ Invalidate affected caches
```

### Idempotency

Financial/state-changing endpoints accept an idempotency key where retries are possible. Repeating the same key must not create duplicate accounting or stock effects.

### State machine enforcement

The database/server layer must reject invalid transitions, not merely disable buttons.

Example:

```text
DRAFT → SUBMITTED → APPROVED → POSTED
```

A client must not be able to call an endpoint with `status=POSTED` and bypass approval.

### Concurrency

Use transactions and appropriate row locking/version checks for:

- Stock posting
- Reservations
- Invoice/payment allocation
- PDC transitions
- Reconciliation finalization
- Number generation

Never trust a cached stock balance during a critical write.

---

# 23. Audit & History

Audit:

- User/security changes
- Invoice/bill/payment/receipt changes
- PDC changes
- Stock adjustments/transfers/counts
- Commercial price/cost changes
- Picking/reassignment
- Bank matching/reconciliation
- Currency conversions/FX adjustments
- Configuration/workflow/template changes
- Attachments
- Other material state changes

Minimum:

```text
user_id
action
entity_type
entity_id
timestamp
old_value
new_value
ip/device where appropriate
request/correlation id
```

Avoid storing secrets or unnecessary sensitive data in audit payloads.

Critical financial history is never hard-deleted. Use cancellation/reversal/archive.

---

# 24. Data Integrity & Accounting Invariants

The database and tests must enforce at minimum:

- Journal entries balance: total debit = total credit.
- Posted transactions cannot be silently edited.
- Invoice totals equal line calculations + configured tax/charges.
- Payment/receipt allocations cannot exceed valid outstanding amounts unless an explicit advance/overpayment model exists.
- Stock movements have valid direction/type and cannot reference invalid stock identity.
- Transfer out and transfer in are one controlled logical transaction.
- GDN stock deduction is atomic.
- Invoice posting and receivable journal are atomic.
- Supplier bill/payment allocations retain actual transaction/settlement currencies and rates.
- Currency conversions preserve both sides and history.
- Bank reconciliation cannot finalize with unexplained difference unless policy explicitly allows an approved exception.
- Every state-changing financial operation is auditable.
- `NULL/PENDING` and numeric zero are semantically distinct.
- Finalized payroll retains the salary/rates/earnings/deductions actually used for that period.
- Employee advance balances cannot be reduced without an auditable recovery/adjustment transaction.
- Assembly labour earnings require approved payable quantity and cannot duplicate the same approved assembly work.
- Assembly labour rate changes never rewrite historical earnings.
- Employee payable equals approved payroll/employee earnings less valid deductions/recoveries and payments.

---

# 25. Testing Strategy

Every feature follows:

```text
Requirement
→ Schema/migration
→ Constraints
→ Business rules
→ Permissions
→ RLS
→ Server logic
→ Data access/API
→ UI/mobile
→ Attachments
→ Audit
→ Reports
→ Automated tests
→ Negative/security tests
→ Manual workflow test
→ Staging
→ Approval
```

## 25.1 Automated test layers

- Unit tests: calculations/state transitions/validators.
- Integration tests: database/RLS/server transactions.
- Contextual report tests: correct customer/product/voucher parameter binding, quick vs full mode, permission/RLS enforcement, missing-context handling, configurable add/remove/reorder behavior, bounded quick-view queries and preservation of unsaved voucher state.
- API tests: authorization, validation, idempotency.
- E2E tests: critical business workflows.
- Security tests: role isolation/RLS/data leakage.
- Performance tests: realistic data volume and concurrent users.
- Migration tests: fresh install + upgrade path.
- Backup/restore tests.

## 25.2 Critical E2E scenarios

1. Auth/RBAC/RLS isolation.
2. Product/customer/supplier creation.
3. Opening stock → receipt → transfer → adjustment.
4. PO → receipt → supplier bill → payment.
5. SO → picking → GDN → price → invoice → receipt.
6. Partial delivery and multiple GDNs.
7. Customer-specific last-price suggestion.
8. Partial/multiple supplier payments with different FX rates.
9. Payment-agent advance → supplier settlement.
10. PDC held → due → deposit → clear/bounce/re-present.
11. Bank import → match → create missing entry → reconcile.
12. Attachment authorization.
13. Assembly/disassembly/bundles.
14. Progressive stock count.
15. Payroll period: fixed salary + assembly labour + bonus + advance recovery + leave + employee payment.
16. Month simulation + full reconciliation.

## 25.3 Mandatory negative tests

Warehouse/staff/salesperson/accountant must each be tested against unauthorized financial, customer, supplier, accounting, role and cross-user data.

Security failure blocks progression.

---

# 26. Production Architecture & Operations

Environments:

```text
DEV → STAGING → PRODUCTION
```

Prefer separate Supabase projects and R2 buckets.

CI must run:

- Lint/typecheck
- Unit/integration tests
- Build
- Migration validation
- Security/dependency scan
- Relevant E2E tests

Production:

- Protected main branch
- Required PR review
- Automated deployment after approval
- Migration backup/rollback plan
- Monitoring/error tracking
- Database backup verification
- Restore drills
- Performance monitoring
- Slow-query review
- Audit-log monitoring

Never experiment directly on production.

---

# 27. Development & Business Implementation Strategy

## 27.1 Core strategic rule

**Build and fully test the complete ERP application first. Implement it in the business gradually afterward.**

Development and business implementation are separate timelines:

```text
DEVELOPMENT
Blueprint → Build all modules → Integrate → Full QA → Security → Performance → UAT → Release Candidate

BUSINESS IMPLEMENTATION
Release Candidate → Warehouse/Stock → Sales/Dispatch → Commercial → Accounting → Advanced Finance → Full ERP
```

The ERP must be architected as one integrated system from the beginning. Operational implementation may activate only selected domains at first.

**Do not build a temporary warehouse-only architecture and later redesign it for accounting.** Inventory, sales, purchasing and accounting must share the final canonical database, transaction engines, identifiers, audit model and security model even when some domains are not yet active in live operations.

Development uses DEV/STAGING test data. Live business implementation begins only after the complete ERP passes the release gate.

## 27.2 Development stages — complete the application before implementation

### Development Stage 1 — Platform foundation

Build and test:

- Repository/monorepo structure
- DEV/STAGING/PRODUCTION environments
- CI/CD
- Shared TypeScript packages
- Database migration framework
- Authentication
- Profiles/users
- Roles, permissions and scopes
- RLS
- Audit framework
- Shared data-access/API patterns
- Error handling, logging and observability
- Private R2 attachment foundation

Test before continuing:

- Login/logout/session handling
- Role and permission isolation
- Direct API/RLS access attempts
- Audit creation
- Migration install/upgrade
- Unauthorized data access
- Basic performance and error handling

### Development Stage 2 — Master data

Build and test:

- Customers
- Suppliers
- Products
- Product variants
- Categories/brands/attributes
- Units and conversions
- Warehouses
- Locations
- Employees/staff
- Currencies
- Banks
- Payment agents
- Accounting master data

Test before continuing:

- CRUD and validation
- Duplicate prevention
- Deactivation rules
- Relationships
- Unit conversions
- Scope restrictions
- Audit/history

### Development Stage 3 — Core inventory engine

Build and test:

- `stock_movements` authoritative ledger
- Stock balances/read model
- Opening stock
- Goods receipt
- Transfers
- Adjustments
- Reservations
- Picking
- Stock counts
- Negative-stock controls
- Physical units/segments/rolls
- Variable quantity/length/weight handling
- Assembly/disassembly
- Bundles
- Concurrency/idempotency controls

Test before continuing:

```text
Opening → Receipt → Transfer → Reservation → Pick → Adjustment → Count
```

Verify every movement against warehouse/location/product balances. Test partial operations, duplicate submissions, concurrent stock changes, reversal/correction and unauthorized access.

### Development Stage 4 — Accounting engine

Build and test:

- Chart of Accounts
- Journal headers/lines
- Posting engine
- Customer ledger
- Supplier ledger
- Receivables/payables
- Cash/bank
- Accounting periods
- Reversal/correction mechanisms

Test before continuing:

- Debit = credit
- Posting is atomic
- Customer/supplier balances reconcile
- Cash/bank balances reconcile
- Period/state rules work
- Unauthorized posting fails
- Corrections preserve history

### Development Stage 5 — Sales + warehouse workflow

Build and test:

```text
Quotation → Sales Order → Reservation/Picking → GDN → Invoice → Receipt
```

Include:

- Partial deliveries
- Multiple GDNs per SO
- GDN stock deduction
- Dispatch status
- Staff assignment/reassignment
- Attachments
- Audit/history
- Commercial price task integration

Test complete sales workflows and partial-delivery edge cases.

### Development Stage 6 — Commercial pricing

Build and test:

- Customer-product price history
- Last charged price lookup
- Price suggestion
- Explicit approved price authority
- Delayed GDN pricing
- Price task assignment
- Review/approval
- Price audit/history

Rules:

1. Suggest the last applicable charged price for the same customer/product.
2. Suggestions are not authoritative until accepted/approved.
3. Explicit approved SO/GDN prices remain authoritative.
4. Converting SO/GDN to invoice must preserve the approved price.
5. A newer historical price must never silently overwrite an existing approved transaction price.

### Development Stage 6.5 — Employees, HR, payroll and assembly labour

Build and test:

- Employee master and employment status
- Effective-dated fixed salary assignments
- Payroll periods/runs/lines
- Employee earnings and deductions
- Employee advances and recovery
- Employee payables and payments
- Bonuses
- Leave types, requests and balances
- Product/variant assembly labour rates
- Employee assembly assignments
- Approved completed assembly quantities
- Assembly labour earnings linked to payroll
- Payroll accounting and configurable labour-cost treatment
- Payroll-specific permissions/RLS and audit

Test:

```text
Fixed Salary
+ Approved Assembly Labour
+ Bonus
- Advance Recovery
- Approved Deductions/Leave Treatment
= Employee Payable
```

Also test:

- Salary/rate changes are effective-dated and do not rewrite historical payroll.
- One assembly output cannot generate duplicate employee earnings.
- Multiple employees can receive controlled portions of one assembly job.
- Only approved payable assembly quantity enters payroll.
- Advance recovery cannot exceed the outstanding balance without an authorized exception.
- Payroll posting balances through the accounting engine.
- Warehouse/staff roles cannot access unauthorized salary/payroll data.

### Development Stage 7 — Purchasing

Build and test:

```text
Purchase Order → Goods Receipt → Purchase Cost Task → Supplier Bill → Payment
```

Include:

- Partial receipts
- Delayed/unknown purchase cost
- Supplier price history where applicable
- Supplier bills
- Inventory impact
- Accounts payable
- Attachments and audit

### Development Stage 8 — Shipments and landed cost

Build and test:

- Shipments
- Containers
- Supplier documents
- Tracking/status
- Goods receipt linkage
- Freight
- Insurance
- Customs
- Clearing
- Port charges
- Bank charges
- Landed-cost allocation
- Estimated vs actual costs
- Capitalize vs expense

Test allocation by amount, weight, percentage and manual allocation, including reconciliation of total allocated cost.

### Development Stage 9 — Payments, multi-currency and agents

Build and test:

- Multi-currency transactions
- Individual FX rates per payment
- FX gain/loss
- Currency conversion vouchers
- Payment agents/money exchanges
- Agent advances/clearing
- Agent payables
- Supplier settlements
- Unallocated advances
- Agent utilization reports

Never replace historical transaction FX rates with weighted averages.

### Development Stage 10 — PDC and bank reconciliation

Build and test:

```text
PDC: Received/Issued → Held → Due → Deposited → Cleared
                         ↘ Bounced → Re-presented → Cleared
```

Bank reconciliation:

- Statement import
- Duplicate-safe import
- Automatic matching suggestions
- Manual matching
- One-to-many/many-to-one
- Create missing entries
- Split entries
- Undo reconciliation
- Reconciliation history

### Development Stage 11 — Reporting, dashboards and exports

Build and test reports for:

- Sales
- GDN/dispatch
- Inventory
- Stock movement
- Stock valuation
- Customer aging
- Supplier aging
- Receivables/payables
- General ledger
- Trial balance
- P&L/balance sheet
- Cash/bank
- Purchases
- Shipments/landed cost
- Payment agents
- PDC
- Audit/activity

Reports must reconcile to authoritative transaction data.

### Development Stage 12 — Configuration and document engine

Build and test:

- Custom fields
- Configurable forms
- Workflow definitions
- Approval rules
- Document templates
- Numbering/configuration
- Notification rules
- Configurable reports
- Contextual quick-report and voucher shortcut configuration

Configuration must never bypass server-side business rules, RLS, inventory controls, accounting controls or audit requirements.

### Development Stage 13 — Interfaces

Complete all planned interfaces:

- Main ERP/office
- Warehouse/staff
- Owner/management
- Salesperson
- Mobile/responsive workflows

The same transaction engine must serve every interface. Do not duplicate business logic in mobile/frontend applications.

### Development Stage 14 — Full-system integration

Run complete cross-module workflows using realistic test data:

```text
Customer → SO → Picking → GDN → Price → Invoice → Receipt → Customer Ledger
Supplier → PO → Receipt → Cost → Bill → Payment → Supplier Ledger
Shipment → Receipt → Landed Cost → Inventory Valuation → Accounting
Bank → Agent → Currency → Supplier Settlement → FX/Agent Ledger
Bank Statement → Match → Accounting → Reconciliation
PDC → Due → Deposit → Clear/Bounce/Re-present
```

No module is considered production-ready merely because its own screens work.

### Development Stage 15 — Full QA, security and performance

Before any business implementation:

- Unit/integration/API/E2E tests
- Full reconciliation tests
- RBAC/RLS tests
- Negative security tests for every role
- Concurrency/idempotency tests
- Realistic-volume performance tests
- Slow-query analysis
- Backup/restore tests
- Migration rehearsal
- Attachment security tests
- Browser/mobile compatibility
- Audit/history verification
- Report reconciliation
- UAT using realistic workflows

Critical accounting, inventory, security, data-integrity or reconciliation failures block release.

### Development Stage 16 — Release candidate

Prepare:

- Production migrations
- Production configuration
- Master-data import templates
- Opening stock import/count templates
- Accounting opening-balance templates
- Price-history import where needed
- User/role configuration
- Document numbering
- Training/SOPs
- Cutover checklist
- Rollback/contingency plan

Only now is the ERP considered ready for business implementation.

# 28. Business Implementation — Gradual Operational Rollout

The complete application is already built and tested. Business implementation is deliberately phased to reduce operational risk and establish reliable physical stock before activating the complete accounting workflow.

## Implementation Phase 1 — Warehouse Management & Accurate Stock

**Primary objective:** Make the ERP the authoritative operational source for physical inventory.

Activate live use of:

- Warehouses
- Locations
- Products/variants
- Opening stock
- Goods receipts
- Transfers
- Adjustments
- Stock counts
- Reservations
- Picking
- Physical units/segments/rolls
- Assembly/disassembly/bundles where applicable
- Warehouse staff assignments
- Stock movement ledger
- Stock balances
- GDN/dispatch preparation as applicable

Accounting does not have to become the live system at this stage. Existing financial processes may continue separately while ERP inventory is stabilized.

### Live warehouse workflow

```text
Physical Goods
    ↓
Warehouse Receipt / Movement
    ↓
ERP Stock Movement
    ↓
Warehouse + Location
    ↓
Current Stock Balance
    ↓
Physical Count / Reconciliation
```

### Phase 1 controls

- Nothing should move between controlled locations without an ERP movement.
- Nothing should leave the warehouse without a controlled dispatch/GDN process once GDN is activated.
- Negative stock must be blocked unless an explicitly authorized exception exists.
- Stock corrections require reason and audit history.
- Physical counts must be compared with ERP balances.

### Phase 1 acceptance tests

Test daily/weekly:

1. Opening stock agrees with approved physical count.
2. Every receipt creates the correct movement.
3. Every transfer changes source/destination correctly.
4. Every adjustment is authorized and auditable.
5. Physical count differences are traceable.
6. Available/reserved stock is correct.
7. Partial picking does not overstate dispatch.
8. Concurrent transactions do not create negative or duplicate stock.
9. Warehouse users cannot access restricted financial data.
10. Stock ledger and stock balance reconcile.

### Phase 1 go-live gate

Do not proceed to the next implementation phase until stock accuracy is demonstrated through repeated reconciliation cycles and warehouse users can complete normal operations without bypassing the ERP.

## Implementation Phase 2 — Sales, Picking & Dispatch

Activate:

```text
Sales Order
    ↓
Reservation
    ↓
Picking
    ↓
GDN
    ↓
Stock Deduction
```

The objective is to control the physical dispatch process before making the ERP the complete financial system.

Test:

- Full delivery
- Partial delivery
- Multiple GDNs per SO
- Cancelled/returned dispatch
- Warehouse reassignment
- Dispatch attachments
- Customer/order linkage
- Stock deduction
- GDN audit trail

**Operational rule:** once this phase is live, physical goods must not leave the controlled warehouse without the approved ERP dispatch process.

## Implementation Phase 3 — Commercial Data & Pricing

Activate:

- Customers
- Quotations/SOs
- Customer-product price history
- Last charged price suggestions
- Price tasks
- Price approval/review
- GDN-to-invoice preparation

The initial financial posting may still remain outside the ERP if required, but the commercial data and approved transaction price should be captured consistently in the ERP.

### Phase 3 acceptance tests

- Customer A receives its own historical price.
- Customer B receives its own historical price.
- Last-price suggestion does not overwrite approved prices.
- GDNs can exist with price `PENDING/UNKNOWN`.
- Price tasks are assigned and auditable.
- Approved price survives SO/GDN → invoice conversion.

## Implementation Phase 4 — Accounting & Financial Posting

Activate the complete financial connection:

```text
GDN
 ↓
Invoice
 ↓
Customer Ledger
 ↓
Receivable
 ↓
Receipt
 ↓
Cash/Bank
```

and:

```text
PO
 ↓
Receipt
 ↓
Purchase Cost
 ↓
Supplier Bill
 ↓
Payable
 ↓
Payment
```

Activate:

- COA
- Journals
- Invoices
- Supplier bills
- Customer/supplier ledgers
- Receivables/payables
- Cash/bank
- Accounting periods
- Posting/reversal

### Phase 4 acceptance tests

- Every invoice posts correctly.
- Customer ledger agrees with invoices/receipts.
- Supplier ledger agrees with bills/payments.
- Stock and GDN quantities reconcile with invoices.
- Debit = credit for every posting.
- Reversals preserve history.
- Existing opening balances reconcile to approved legacy records.

## Implementation Phase 5 — Advanced Financial Operations

Activate:

- Multi-currency
- FX gain/loss
- Payment agents/money exchanges
- Supplier settlements
- PDC
- Bank reconciliation
- Shipments/landed-cost accounting
- Advanced financial reports
- Period closing

### Acceptance tests

- Actual payment FX rates remain unchanged historically.
- Agent advances reconcile to agent utilization.
- Supplier settlements reconcile to supplier balances.
- PDC status and accounting remain synchronized.
- Bank statements reconcile without duplicates.
- Landed costs reconcile to inventory valuation.
- Financial reports reconcile to ledgers.

## Implementation Phase 6 — Full ERP Operation

All major workflows operate inside the ERP:

```text
WAREHOUSE
   ↓
SALES / PURCHASING
   ↓
COMMERCIAL
   ↓
INVENTORY
   ↓
ACCOUNTING
   ↓
PAYMENTS / BANK / FX
   ↓
REPORTING / MANAGEMENT
```

The ERP becomes the primary operational and financial system after final reconciliation and management approval.

# 29. Implementation Testing Gates

Each implementation phase has its own live-business acceptance gate. Passing a development-stage test does not automatically authorize live implementation.

For every implementation phase use:

```text
Configure
→ Train
→ Controlled Pilot
→ Reconcile
→ Fix
→ Repeat
→ Management Sign-off
→ Expand
```

## Gate A — Warehouse

Must pass:

- Opening stock reconciliation
- Receipt test
- Transfer test
- Adjustment test
- Physical count test
- Negative-stock test
- Concurrent movement test
- User-permission test

## Gate B — Sales/Dispatch

Must pass:

- SO → picking → GDN
- Partial delivery
- Multiple GDNs
- Return/cancellation
- Stock deduction
- Dispatch authorization
- Warehouse security

## Gate C — Commercial

Must pass:

- Customer-specific last-price suggestion
- Price override/approval
- Pending price task
- SO/GDN → invoice price preservation
- Price history/audit

## Gate D — Accounting

Must pass:

- Invoice posting
- Customer ledger
- Receipt
- Supplier bill
- Supplier ledger
- Payment
- Trial balance
- Opening-balance reconciliation

## Gate E — Advanced Finance

Must pass:

- FX
- Payment agents
- PDC
- Bank reconciliation
- Landed cost
- Financial reports

## Gate F — Full ERP

Must pass:

- Complete E2E scenarios
- Month simulation
- Stock reconciliation
- Customer/supplier reconciliation
- Bank reconciliation
- Financial statement reconciliation
- Security review
- Performance review
- Backup/restore

# 30. Production Architecture & Operations

Environments:

```text
DEV → STAGING → PRODUCTION
```

Prefer separate Supabase projects and R2 buckets.

CI must run:

- Lint/typecheck
- Unit/integration tests
- Build
- Migration validation
- Security/dependency scan
- Relevant E2E tests

Production:

- Protected main branch
- Required PR review
- Automated deployment after approval
- Migration backup/rollback plan
- Monitoring/error tracking
- Database backup verification
- Restore drills
- Performance monitoring
- Slow-query review
- Audit-log monitoring

Never experiment directly on production.

# 31. Development Order for the Coding Agent

The coding agent should build the **complete application** in dependency order. This order is not the business implementation order.

Recommended sequence:

1. Repository, environments, CI/CD and shared packages.
2. Database migration framework and canonical schema foundation.
3. Auth, profiles, roles, permissions, scopes, RLS and audit.
4. Master data: customers, suppliers, products, variants, units, warehouses and locations.
5. Inventory engine and inventory tests.
6. Accounting engine and accounting tests.
7. Employees, HR, payroll, advances, leave, bonuses and assembly labour.
8. Sales, picking, GDN and commercial pricing.
9. Purchasing, receipts, supplier bills and landed cost.
10. Shipments and document tracking.
11. Payments, FX and payment agents.
12. PDC and bank reconciliation.
13. Reports, dashboards, exports, notifications and attachments.
14. Configurable fields, workflows and document templates.
15. Office, warehouse, owner/management, salesperson and mobile/responsive interfaces.
16. Full cross-module integration.
17. Complete security, performance, backup/restore and UAT.
18. Production release candidate.
19. Business implementation begins only after step 18.

Every coding task must remain small enough to review, test and revert.

# 32. Implementation Readiness Gate

Business implementation must not begin until all are true:

- All required ERP modules are developed.
- Major end-to-end workflows work across modules.
- Database migrations are version-controlled and tested.
- Accounting and inventory invariants pass reconciliation.
- RBAC/RLS passes negative/security testing.
- Production performance targets are measured against realistic data.
- Backup/restore is tested.
- Legacy-data migration is rehearsed.
- Reports reconcile to transactional data.
- Document numbering, taxes, currencies and company settings are validated.
- UAT is signed off.
- Critical/high-severity defects are resolved or formally accepted.
- Production deployment and rollback procedures are tested.
- Training/SOP material is ready.
- Phase 1 warehouse opening stock is approved for live use.

# 33. Definition of Done

## Feature done

A feature is coded, reviewed, tested and integrated without weakening shared architecture or business invariants.

## Module done

A module is complete only when its UI/API, schema, permissions, server validation, audit/history, tests and integration points are complete. Module completion does **not** authorize live implementation.

## ERP done

The ERP is release-ready only when the **entire application** passes integration, security, performance, reconciliation, backup/restore and UAT gates and can be deployed as one coherent production system.

## Implementation phase done

A business implementation phase is complete only when its operational workflows, user training, reconciliation, controls and management sign-off are complete.

## Implementation done

Business implementation is complete only when all planned phases are live, production configuration and opening balances are validated, users are trained, and post-cutover reconciliation is stable.

# 34. AI Coding Assistant Rules

AI coding agents must build the complete ERP before live business implementation, but must work in bounded, reviewable development tasks.

Each task should specify:

- Goal
- Allowed modules/files
- Database/API impact
- Security/RLS requirements
- Performance constraints
- Tests required
- Explicit non-goals

Before implementing any screen from a design reference, the agent must:

1. Extract the visual language into shared design tokens/components.
2. Identify which parts are visual reference versus reference-specific content/layout.
3. Build the ERP's required information architecture independently.
4. Reuse the visual language without copying dashboard widgets, sample content or page structure unless explicitly requested.
5. Use the shared compact form/table/dropdown/dialog components rather than inventing per-screen variants.
6. Treat the supplied Modulix-style screenshots as the approved visual-theme reference: extract the neutral palette, typography, rounded surfaces, subtle borders/shadows, compact controls, semantic badges, icon treatment, sidebar language and modal treatment, but never copy their business content or information architecture.

For every new list screen, implement View-first actions and keep Edit inside View unless the specification explicitly requires another interaction. Separate destructive actions from routine actions.

For every editable form/dialog, implement dirty-state tracking and unsaved-change protection before considering the UI complete. Test browser reload/close, route changes, dialog close and record switching with unsaved data.

Agents may build modules in dependency order, but must not:

- Treat an unfinished module as production-ready.
- Treat module completion as business implementation approval.
- Build a temporary warehouse-only database that later requires redesign.
- Bypass shared inventory/accounting engines.
- Duplicate business rules across applications.
- Disable RLS/security for convenience.
- Modify accounting history directly to repair UI problems.
- Introduce untracked schema changes.
- Deploy unfinished functionality into the live business.

For every bounded coding task use:

```text
Understand canonical rule
→ Design
→ Code
→ Unit/integration tests
→ Security/RLS tests
→ Review
→ Integrate
→ Regression tests
```

After the complete application is built:

```text
Full Integration
→ Full QA
→ Security Hardening
→ Performance Testing
→ UAT
→ Release Candidate
→ Business Implementation
```

# 35. Final Architecture Rule

```text
ONE ERP
  ↓
ONE DATABASE PER ENVIRONMENT
  ↓
ONE SECURITY MODEL
  ↓
ONE INVENTORY ENGINE
  ↓
ONE ACCOUNTING ENGINE
  ↓
ONE ATTACHMENT ENGINE
  ↓
ONE AUDIT/HISTORY ENGINE
  ↓
ONE HR/PAYROLL/LABOUR ENGINE
  ↓
MULTIPLE CONTROLLED APPLICATIONS
  ↓
COMPLETE ERP BUILT + TESTED FIRST
  ↓
GRADUAL BUSINESS IMPLEMENTATION
```

**Development principle:** Build the complete integrated ERP before live implementation.

**Implementation principle:** Start live business use with warehouse management and accurate stock handling, then progressively activate sales/dispatch, commercial pricing, accounting and advanced financial operations.

**Architecture principle:** Even when accounting is not yet live, the warehouse and transaction model must already be designed to connect to the final accounting engine without redesign.

**Control principle:** No business phase may bypass the final ERP security, inventory, accounting, audit or data-integrity rules.




## Customer Statement — Primary Business Report

The **Customer Statement** is a first-class, high-frequency report and MUST be designed for everyday use by non-technical customers and staff. It must prioritize clarity, familiar terminology, readable spacing, and direct access to the underlying transaction.

### Statement Columns

Each transaction row should normally show:

| Column | Purpose |
|---|---|
| Date | Transaction date |
| Voucher No. / Reference | Human-readable document/reference number; clickable View action |
| Transaction Type | Plain-language type such as Sales Invoice, Sales Receipt, Purchase Bill, Purchase Payment, Sales Return, Return Receipt, etc. |
| Debit | Amount increasing the customer's receivable/payable balance according to the account direction |
| Credit | Amount reducing the customer's receivable/payable balance according to the account direction |
| Balance | Running balance after the transaction |
| View | Opens the exact underlying transaction in the standard View dialog/page |

The exact debit/credit meaning must follow the customer's account orientation and configured ledger rules; the statement must never display a misleading sign convention.

### Supported Transaction Types

The statement should support, as applicable:
- Sales Invoice
- Sales Receipt / Customer Payment
- Purchase Bill
- Purchase Payment
- Sales Return
- Return Receipt / Refund
- Opening Balance
- Journal Adjustment
- Credit Note / Debit Note
- Advance Receipt / Advance Payment
- Other configured customer-related ledger transactions

Transaction types must be configuration-driven rather than hard-coded, while the core accounting meaning and posting rules remain system-controlled.

### Transaction Detail Under Each Row

Where a transaction has meaningful line-level or payment-level detail, the statement should support an **expand/collapse detail section directly under the transaction row**.

Examples:

**Sales Invoice**
- Product name
- Variant, where applicable
- Quantity
- Unit of measure
- Rate / unit price
- Line amount
- Optional discount/tax where relevant
- Invoice total

**Purchase Bill**
- Product name
- Variant, where applicable
- Quantity
- Unit of measure
- Purchase rate
- Line amount
- Optional discount/tax where relevant
- Bill total

**Sales Return**
- Product name
- Variant, where applicable
- Returned quantity
- Rate
- Return amount

**Customer Receipt / Sales Receipt**
- Payment amount
- Bank / cash account name
- Payment method
- Cheque/PDC reference where applicable
- Payment/reference number where applicable

**Purchase Payment**
- Payment amount
- Bank / cash account name
- Payment method
- Cheque/PDC reference where applicable
- Payment/reference number where applicable

**Other transaction types**
- Show the most relevant underlying details for that transaction type using the same simple, human-readable pattern.
- Do not display irrelevant technical database fields merely because they exist.

### Human-Friendly Presentation

The Customer Statement MUST be understandable to a customer who is not technically or financially sophisticated.

Rules:
- Prefer plain labels such as **Sales Invoice**, **Payment Received**, **Purchase Bill**, **Return**, and **Refund** instead of internal codes.
- Avoid exposing database IDs, UUIDs, internal posting codes, table names, API terminology, or accounting implementation details.
- Use clear headings and consistent terminology throughout the statement.
- Use readable number formatting with currency symbols/currency codes where appropriate.
- Use visually distinct but restrained formatting for Debit, Credit, and Balance.
- Keep the running balance prominent.
- Make transaction details visually subordinate to the main statement row so the statement does not become cluttered.
- Long product lists should remain readable through compact line items and controlled expansion rather than excessively wide columns.
- Do not require the user to understand accounting software concepts to interpret what happened.
- Customer-facing/printable statements should use customer-friendly wording even if the internal ERP uses more technical transaction names.

### View and Drill-Down

Every statement row representing an underlying transaction MUST have a **View** action.

- View opens the exact original transaction using the standard ERP View component.
- The user can see the complete underlying voucher, including all permitted fields and attachments.
- If authorized, Edit remains available from inside View rather than directly from the statement.
- The statement's filters, date range, scroll position, and expanded/collapsed state should be preserved when returning.
- A transaction detail expansion is a quick summary and MUST NOT replace the full View action.

### Statement Filters

At minimum, support:
- Customer
- Date from / date to
- Transaction type
- Debit/Credit/all transactions
- Opening balance inclusion
- Currency, where applicable
- Status where relevant

Common date presets should include:
- Today
- This week
- This month
- Previous month
- This financial year
- Custom range

### Opening and Closing Balance

The statement should clearly show:
- Opening balance before the selected period
- Transactions within the selected period
- Running balance after each transaction
- Closing balance at the end of the selected period

The opening balance must be calculated from posted/valid ledger transactions before the selected period according to the accounting rules. Draft or unposted transactions must not silently affect the balance.

### Quick Statement Mode

Because Customer Statement is frequently consulted from vouchers, it MUST support a compact **Quick Customer Statement** mode in addition to the full report.

The quick version may show:
- Recent transactions
- Date
- Voucher/reference
- Type
- Debit
- Credit
- Balance
- View

The quick version should allow one-tap access to the full Customer Statement and should use the current customer automatically when opened from a customer-related voucher.

### Performance and Data Integrity

- The statement should query indexed ledger/posting data and avoid loading unrelated customer data.
- Running balances must be deterministic and based on posted accounting entries.
- Reversed/cancelled transactions must be represented according to the configured accounting presentation rules and must not incorrectly inflate the balance.
- Detail expansion should load only the selected transaction's necessary detail when practical.
- Quick Statement must use bounded result sets and pagination rather than loading the customer's complete history.
- Currency handling must preserve the transaction currency and configured base-currency/accounting presentation rules; historical actual FX rates must not be rewritten.
- The statement must reconcile to the authoritative customer ledger.

### Customer Statement Print / PDF

The printable/PDF version should be optimized for customers rather than developers/accountants:
- Customer name and relevant contact/reference information at the top
- Statement period
- Opening balance
- Clearly structured transaction table
- Transaction type in plain language
- Debit, Credit, and Balance columns
- Transaction details shown in a compact readable form where configured
- Closing balance
- Currency clearly identified
- Company identity/contact information according to document configuration
- Page numbering and repeated table headings on multi-page statements
- No unnecessary technical fields

The system should support a configurable choice between:
1. **Summary Statement** — transaction rows only
2. **Detailed Statement** — transaction rows with transaction details

Both formats must retain direct View/drill-down capability in the interactive ERP version.

## Global Report Row View Rule

Every report that displays rows representing an underlying ERP record, transaction, document, master-data record, ledger entry, payment, stock movement, or other viewable entity MUST provide a **View** action/button on each applicable row.

### Requirements
- **View is the primary row action** wherever an underlying record exists.
- Clicking **View** opens the underlying entry in its standard **View dialog/page**, using the same read-only view component used elsewhere in the ERP.
- The report must open the exact underlying record, not a reconstructed approximation of the report row.
- The underlying record's normal permissions, RLS, field-level restrictions, and audit/security rules still apply.
- If the user has edit permission, the standard View screen may expose **Edit** from inside the View screen; reports should not bypass the normal View → Edit flow.
- Where appropriate, the View screen may also expose related actions such as Print, Attachments, Audit History, or linked documents according to permissions.
- The View action must preserve the report's current filters, pagination, sorting, and unsaved state when the user returns.
- For reports containing multiple row types, the View action must resolve to the correct underlying entity type for each row.
- If a row is purely calculated/aggregated and has no single underlying record, a View button is not required. Where practical, provide an appropriate **Drill Down / Details** action instead.
- Summary/grouped reports should provide drill-down to the underlying rows and then View actions on those underlying records where applicable.
- Reports must not require users to leave the report and manually search for the underlying transaction when a direct record reference exists.
- The View action should use optimized record lookup and must not load unnecessary unrelated data.
- Do not create separate report-specific view dialogs when an existing standard entity View component can be reused.

### Report UI Standard
Default row action order:
1. **View**
2. Other permitted non-destructive actions
3. Edit only where explicitly appropriate; otherwise Edit remains inside View
4. Destructive actions, if any, remain separated and permission-controlled

This rule applies globally to sales, purchases, inventory, accounting, payments, banking, PDC, customers, suppliers, employees/payroll, shipments, landed cost, audit, and other applicable reports.


### Customer Statement — Bundle Display Configuration

For transactions containing bundles, the Customer Statement must allow the user to choose how bundle information is presented, without changing the underlying transaction data:

- **Bundle Name Only** — show the bundle as a single line using the bundle's commercial name, with its total quantity, rate/amount where applicable.
- **Complete Bundle Details** — expand the bundle to show the bundle name plus its component products/variants and their relevant quantities, rates and amounts according to the transaction/report configuration.
- This setting must be configurable for the statement/report and, where appropriate, separately for on-screen, print and PDF output.
- The selected presentation mode affects display only; it must never alter inventory movements, accounting entries, original invoice/bill data, pricing history, or bundle/component traceability.
- The statement must retain the ability to open the underlying voucher using its **View** action, regardless of the selected bundle display mode.
- For a customer-facing statement, the default should favor the simpler **Bundle Name Only** presentation unless the user selects complete details.
- If a bundle contains nested bundles, the configured detail level must be applied consistently and must prevent confusing recursive presentation.


## Customer Groups, Farms & Separate/Collective Ledgers

The ERP must support customers that operate through multiple farms, branches, projects, business units, or separately tracked orders while still maintaining a controlled collective receivable/payable view.

### Customer Structure
- A **Customer Group / Parent Account** may have multiple linked **Customer Accounts / Farms**.
- Each farm/customer account remains a real transaction and ledger entity with its own sales, invoices, receipts, returns, payments, aging and balance.
- Transactions must be posted to the actual farm/customer account that made the sale or incurred the liability.
- The parent/group relationship must never merge or rewrite the underlying farm-level transactions.

### Separate Ledgers with Collective Balance
- Users can view each farm/customer account separately.
- Users can also view a **Consolidated Group Statement** combining all linked accounts.
- The group balance is derived from the balances of linked accounts and must not create duplicate accounting entries.
- A payment received against the parent/group may be allocated to one or more child farm/customer accounts, subject to authorization and an auditable allocation record.
- A payment may remain **unallocated** at group level until the responsible user assigns it to specific farm/customer balances.
- Partial allocation, multi-invoice allocation and allocation across multiple farms must be supported.
- Allocation must prevent over-application and preserve the original payment and invoice history.

### Orders / Commercial Tracking
- A customer group may have multiple independent orders, projects, farms or commercial relationships that users want to track separately.
- Each relationship can have its own ledger view and transaction history while remaining linked to the same parent group.
- Customer-specific pricing, credit limits, payment terms and other settings may be configured at group, farm/customer, or relationship level according to authorization and inheritance rules.
- The system must clearly show which level supplied an effective setting; it must not silently replace a farm-level approved setting with a parent-level value.

### Customer Statement Modes
Customer statements must support at least:
1. **Individual Account Statement** — only the selected farm/customer account.
2. **Group / Consolidated Statement** — all linked farm/customer accounts, with the originating farm/account clearly identified on every applicable transaction.
3. **Group Balance Summary** — opening balance, current balance and key totals for each farm/account plus the collective total.

### Group Payment Example
Example: ABC Group has Farm A, Farm B and Farm C. Sales are invoiced separately to each farm, but ABC Group sends one payment covering its collective outstanding balance. The ERP must allow the payment to be received at group level and then allocated to Farm A/B/C invoices without losing the original farm-level ledger history. Until allocation, it must be clearly shown as an unallocated group payment rather than incorrectly reducing a specific farm's balance.

### Security & Audit
- Only authorized users may create/change parent-child customer relationships or move an account between groups.
- Payment allocations and re-allocations must be fully audited.
- Group visibility must respect user permissions; access to one farm must not automatically grant access to every linked farm unless the role permits consolidated access.
- Reports and quick views must identify whether a balance is individual, group-consolidated, or includes unallocated group payments.

### Data Model Requirements
Use relational relationships rather than duplicate customer records or hard-coded farm columns. Support fields/entities equivalent to:
- `customer_groups`
- `customer_group_members` or parent/customer relationship fields
- `customer_accounts` / existing customer master with group linkage
- `customer_payment_allocations`
- group-level payment/unallocated balance state
- optional `customer_relationships` for separately tracked commercial/order relationships

All consolidated balances must be calculated from authoritative accounting/ledger data. No manually maintained collective balance field may become the accounting source of truth.


## Universal Voucher Attachments & Document Uploads

Every applicable ERP voucher/document must support attachments directly from its View/Create/Edit interface. Attachments are linked to the underlying record through a reusable attachment system rather than separate file fields on individual voucher tables.

### Supported file types
- Images: JPG/JPEG, PNG, WEBP and other explicitly allowed image formats
- PDF
- Microsoft Office documents: DOC/DOCX, XLS/XLSX, PPT/PPTX
- Common text/document formats where enabled by configuration
- The allowed MIME types, extensions and maximum file sizes must be configurable and enforced server-side.

### Image optimization
- Before storing an uploaded image, the system should automatically optimize/compress it to an appropriate quality/size balance.
- Compression must be **visually loss-aware but business-safe**: optimize ordinary photos/scans without making invoices, receipts, signatures, stamps, serial numbers, labels or other important text unreadable.
- Preserve orientation and correct metadata handling during processing.
- Do not repeatedly recompress an already optimized image on every view/download.
- Store the optimized version as the normal application copy; where retention policy or audit requirements require it, the original upload may be retained separately as an immutable original.
- Image optimization must not modify the underlying voucher or document data.

### Upload and storage
- Attachments use private object storage (Cloudflare R2 or equivalent) with PostgreSQL metadata.
- Store attachment metadata including entity type, entity ID, file name, MIME type, extension, size, storage key, checksum/hash, uploader, timestamps, optimization status, and optional description/category.
- Use signed/authorized URLs for access; never expose private storage objects publicly.
- Validate MIME type and file signature, not only the filename extension.
- Apply server-side size limits, authorization, malware/security scanning where available, and safe filename handling.
- Use immutable/versioned attachment history where replacement or deletion could affect auditability.
- Attachment deletion must be permission-controlled and audited; critical financial evidence should not be silently hard-deleted.

### Voucher UX
- Provide a consistent **Attachments** area on every applicable voucher.
- Support drag-and-drop, file picker, multi-file upload, upload progress, retry, preview where supported, download, description/category, and remove/archive according to permissions.
- Show attachment count on voucher lists/views where useful.
- Attachments remain available when the voucher moves through its workflow, including draft, approval, posting and View mode.
- The standard View dialog must show linked attachments without requiring the user to open a separate document-management module.
- Reports with a View action should open the voucher's normal View screen, where its attachments are accessible.

### Common attachment examples
Sales Order: customer PO, quotation, specifications.
GDN: delivery evidence, gate pass, signed acknowledgement.
Sales Invoice: customer documents, supporting calculations, signed copy.
Receipt/Payment: bank advice, deposit slip, cheque/PDC image, payment proof.
Purchase Order/Bill/GRN: supplier quotation, invoice, packing list, receiving evidence.
Bank/Reconciliation: statement, bank advice, supporting voucher.
Shipment/Landed Cost: BL, commercial invoice, packing list, customs and clearing documents.
Employee/Payroll: permitted employee documents and payroll support, subject to strict HR permissions.

### Security and integrity
- Attachment access follows the permissions of the underlying voucher/entity and must be enforced server-side and through RLS where applicable.
- Sensitive HR, financial and commercial attachments must not become visible merely because a user can see a related report.
- Attachment operations are audited.
- Duplicate uploads should be detected using checksum/hash where practical.
- Upload processing must be asynchronous where appropriate so large files do not block voucher submission.
- Failed optimization/scanning must not result in a misleading successful upload state.
- Attachment links must remain traceable to the exact underlying voucher/version.
