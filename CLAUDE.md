# JS Traders ERP — working notes for Claude

Read this first, then `docs/HANDOFF.md` (where we stopped) and `docs/JS_Traders_ERP_Development_Tracker.txt` (stage status + sprint log).
Spec: `docs/JS_Traders_ERP_Master_Specification_OPTIMIZED.md` (v2.0).

## Owner
Ahmad — JS Traders, poultry equipment, Okara. After every sprint report: what was developed, how to test it, what the next phase is.

## Systems
- GitHub: `ahmadok12/JS-Traders-Accounts-App` (PUBLIC repo — never commit secrets, keystores, tokens or service keys).
- Web app: Vercel project **js-traders-accounts-app-1fsw** → https://js-traders-accounts-app-1fsw.vercel.app (deploys on push to `main`). Other Vercel projects are being deleted — ignore them.
- Database: Supabase project **JS Traders ERP App**, ref `rjdjaujoilcunwtynaze` (ap-southeast-1). Migrations in `supabase/migrations` are applied to the live DB with the Supabase MCP (`apply_migration`) — keep the file and the live DB in step.
- Edge functions: `attachments` (Cloudflare R2 bucket `jst-erp-files`, falls back to Supabase Storage bucket `attachments`), `warehouse-staff`. Secrets live in Supabase → Edge Functions → Secrets.
- Android "JS Picking" app (`android/`): WebView of `/m`; built + released by `.github/workflows/android.yml` on pushes touching `android/**`; signing key is in GitHub Actions secrets (backup kept offline by Ahmad).
- Commits: author `Claude <noreply@anthropic.com>`.

## Conventions
- Monorepo: `apps/admin-erp` (Vite + React + TanStack Query), `packages/{ui,data-access,permissions,types,utilities}`.
- `npm run typecheck`, `npm run build`, `npx vitest run`. SQL tests in `tests/sql` run inside a transaction and roll back.
- All business rules live in Postgres functions (security definer, `search_path = ''`, permission checks via `inv_require` / `has_permission`).
- Live DB currently holds trial data: opening stock (`supabase/seed/trial_opening_stock.sql`), Settings → Trial data (RESET JST) wipes transactions.
