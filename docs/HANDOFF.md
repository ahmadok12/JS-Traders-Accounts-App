# Handoff — where we stopped (6 Oct 2026)

## Latest work (all live on -1fsw and in the database)
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
- Then **Stage 12** — configuration and document engine (custom fields, print templates, numbering screen, approval and notification rules).

## Setting up the other laptop
1. `git clone https://github.com/ahmadok12/JS-Traders-Accounts-App.git` (or connect the folder in Claude and ask Claude to clone it).
2. `cd JS-Traders-Accounts-App && npm install`
3. Create `apps/admin-erp/.env` by copying `apps/admin-erp/.env.example` (it already has the public Supabase URL + publishable key).
4. `npm run dev` for a local copy — not needed for normal work: the live app is the Vercel -1fsw link.
5. A GitHub token is only needed if Claude pushes from that laptop — create a new fine-grained token (repo: JS-Traders-Accounts-App, Contents + Actions read/write) rather than copying the old one.
6. **Not in GitHub on purpose (keep offline):** `android-signing/` (release keystore + passwords) and the GitHub token file. Copy `android-signing` by USB / private drive as a backup; builds don't need it on the laptop (it is in GitHub Actions secrets).
