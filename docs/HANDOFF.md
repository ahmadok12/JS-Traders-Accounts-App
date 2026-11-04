# Handoff — where we stopped (4 Nov 2026)

## Go-live with real data — 4 Nov 2026
- Trial transactions wiped with `reset_trial_transactions('RESET JST')` (stock, SOs, GDNs, invoices, ledger…); masters kept.
- All 25 trial products (+ prices, BOM components, labour rates) deleted; PRODUCT and roll (R-) numbering restarted at 1.
- 26 real products loaded, category Feeding Systems, every product and variant `allow_negative_stock = true`:
  roll items (tracking PHYSICAL_UNIT, unit FT): Augar 45mm, 3mm / 5mm / 1.2mm Steel Wire; the rest PCS.
  Variants China/Local (Motor Box: China Plastic / Local Steel) on Feed Pipe Round, Hopper 60 x 60, Feed Boot 45mm Single/Double,
  Motor Box 45mm, Shaft 45mm, Feed Line Adjust, Feed Line Hanger, Feed Pulley 45mm, C Clump 45mm, End Patri.
- Then 24 drinking-line products (P-00027…P-00050, category Drinking Systems, same rules): roll items Galvanised Steel Wire 3mm
  and 1.2mm Shocker Wire (FT); China/Local variants on Support Pipe 27mm, Drip Cup, Water Line Hanger, Glue, End Valve,
  Water Level Pipe, Joint, Male/Female Joint, Pulley 24mm, Water Line Adjust, Water Line End Patri.
- Then 34 more (P-00051…P-00084): 90mm/75mm feeding parts (Feeding Systems; Augar 90mm and Augar 75mm are roll items in FT —
  75mm was not marked Rolls in his sheet, set as roll to match the others, told Ahmad) and Air Vent, Cooling Pads, fans,
  Temp R Tron 16 Stage Controller (variants Master Automation / Local) under Ventilation & Cooling.
- Fix `20261104000100_roll_items_negative_stock`: roll items with no rolls could never go negative ("choose the roll(s)" error).
- Ahmad's plan: make delivery notes now (stock goes negative), then count items one by one (Stock count) to correct stock.


## Warehouse trial fixes — 3 Nov 2026 (after Stage 12)
Latest: picker "not accepted" alert (`20261103000700_picking_accept_alert`, pg_cron `jst-picking-unaccepted` every 30 s,
setting `picking.accept_alert_minutes`, default 2, 0 = off, Settings → Features → Picking). Pop-up kinds NOT_ACCEPTED /
ACCEPTED_LATE go to the person who sent the task (else the warehouse's picking managers). See the tracker for the other fixes.

## Stage 12 finished — live 3 Nov 2026
Migrations `20261103000100_stage12b_workflows_forms_channels` + `20261103000200_notify_schedule` applied with the Supabase MCP
(the stored text matches the repo file). Live SQL test 42/42 (rolled back). Edge function `notify-send` deployed.
New: Settings → Workflows (review steps before approve/post, 13 document types), Settings → Forms (per-role hidden/required
fields and sections), custom fields on documents + reference/file/image/date-time/formula types, e-mail/WhatsApp delivery
(pg_cron job `jst-notifications` every 5 min). Owner role got sales.approve, sales.invoice, journals.post.
Still to do by Ahmad for e-mail/WhatsApp: Supabase secrets RESEND_API_KEY, NOTIFY_EMAIL_FROM, WHATSAPP_TOKEN,
WHATSAPP_PHONE_NUMBER_ID; Meta template `erp_alert` with body "JS Traders ERP: {{1}} — {{2}}".
Local DB testing: replay `supabase/migrations` on any Postgres 17 with small Supabase stubs (auth.uid, roles anon/authenticated/service_role).

## Earlier: Stage 12 part 1 — 9 Oct 2026

## Stage 12 — live 9 Oct 2026
Migration `20261014000100_stage12_config_engine` applied to the live DB (via the Supabase SQL editor — it is not in
Supabase's migration list; the Supabase MCP `apply_migration` was being cancelled from the Claude app). Live test 38/38 ok.
New: Settings → Numbering (edit) / Documents (templates, logo) / Custom fields / Approvals / Notifications; bell in the top bar;
Print on sales orders and vouchers; custom fields on master records with list columns + filter.
Note: approval-limit roles must already hold the permission (e.g. Owner has no sales.approve / journals.post today).

## Earlier work (all live on -1fsw and in the database)
1. **Picking photos** — staff app: Take photo / From gallery on each picking task; ≥1 photo required to finish
   (Settings → Features → Picking, default ON). Sales order window: *Picking photos* tab (live) + popup on new photo;
   task dialog *Photos* tab. Migration `20261013000100_picking_photos`. New Android APK built (camera/gallery in the app).
2. **Cloudflare R2 connected** — bucket `jst-erp-files`, secrets set in Supabase; first upload confirmed in R2.
3. **GDN: Save as PDF + WhatsApp** — `apps/admin-erp/src/sales/pdf.ts` (jsPDF). WhatsApp: PDF saved to Downloads,
   WhatsApp desktop opens on the customer's chat with a message (or WhatsApp Web); phones use the share sheet.
4. **Roll selection on sales orders** — "Rolls: auto / choose rolls" per warehouse as soon as a roll item is picked;
   chosen rolls fill the quantity if none typed; dialog scrolls + find box. GDN cuts chosen rolls first, rest auto.
   Pickers and the GDN form show the rolls. Migration `20261013000200_so_roll_selection`.
5. **Trial data** — opening stock in WH-01/WH-02 dated 01-Oct-2026 (stock value 13,242,500), Cash 500,000, Meezan 2,500,000.

## In progress / next
- Ahmad is running the **warehouse-manager trial** (sales order → pickers → photos → GDN → invoice, purchases, returns) and reporting issues with screenshots.
- Possible follow-ups offered: Save as PDF / WhatsApp on invoices and quotations too.
- Next: warehouse-trial fixes, Excel opening-stock import, PDF/WhatsApp on invoices & quotations, stock calculator, then Stage 13 (owner mobile app).

## Setting up the other laptop
1. `git clone https://github.com/ahmadok12/JS-Traders-Accounts-App.git` (or connect the folder in Claude and ask Claude to clone it).
2. `cd JS-Traders-Accounts-App && npm install`
3. Create `apps/admin-erp/.env` by copying `apps/admin-erp/.env.example` (it already has the public Supabase URL + publishable key).
4. `npm run dev` for a local copy — not needed for normal work: the live app is the Vercel -1fsw link.
5. A GitHub token is only needed if Claude pushes from that laptop — create a new fine-grained token (repo: JS-Traders-Accounts-App, Contents + Actions read/write) rather than copying the old one.
6. **Not in GitHub on purpose (keep offline):** `android-signing/` (release keystore + passwords) and the GitHub token file. Copy `android-signing` by USB / private drive as a backup; builds don't need it on the laptop (it is in GitHub Actions secrets).
