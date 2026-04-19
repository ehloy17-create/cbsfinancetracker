# Copilot Instructions

## Commands

### Frontend
```bash
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # Production build
npm run lint         # ESLint for the whole frontend
npm run typecheck    # TypeScript check only (tsconfig.app.json)
```

### Backend
```bash
cd server && npm run dev    # Express API with --watch on http://localhost:4000
cd server && npm start      # Production-style API start
```

### Setup commands from README
```bash
mysql -u root -p gcash_pos < server/schema.sql
cd server && node seed-admin.js
```

### Tests

There is currently no automated test suite, so there is no single-test command.

## High-level architecture

This is a GCash / POS / inventory management system built as a React SPA on top of a local Express + MySQL backend.

```text
React + Vite (5173) -> Express API (4000) -> MySQL (gcash_pos)
src/lib/supabase.ts    server/index.js       server/schema.sql
```

The most important architectural detail is that `src/lib/supabase.ts` is not the Supabase SDK. It is a custom adapter that preserves the calling style the frontend already uses and translates it into local API calls:

- `supabase.from(table)...` -> `GET/POST/PATCH/DELETE /rest/v1/:table`
- `supabase.rpc(name, params)` -> `POST /rpc/:name`
- `supabase.auth.*` -> `/auth/*`

The backend is split into a few coarse layers:

- `server/index.js` boots Express, mounts `/auth`, `/profiles`, `/rpc`, and the generic `/rest/v1/:table` route, then runs schema compatibility helpers on startup.
- `server/routes/generic.js` is the PostgREST-style CRUD layer used by most frontend pages.
- `server/routes/rpc.js` contains transactional business operations and heavier domain logic.
- `server/schema.sql` is the base schema, but `server/schemaCompat.js` also adds newer tables/columns/check constraints during API startup. Treat both as part of the live schema story.

The frontend route tree in `src/App.tsx` reflects the product split:

- `src/pages/` handles GCash and finance pages.
- `src/inventory/` contains inventory, purchasing, receiving, transfers, adjustments, payables, and related hooks/libs.
- `src/pos/` contains terminals, shifts, session flow, and checkout logic.
- `src/reports/` is read-heavy reporting UI.

Most authenticated pages render inside `<Layout>`, but the POS session route (`/inventory/pos/session/:shiftId`) is intentionally mounted outside the layout so it can run fullscreen without the sidebar.

## Key conventions

### The adapter only implements the subset of Supabase used here

Do not assume full Supabase or PostgREST behavior. The local adapter explicitly supports the chaining used in this repo such as `.eq()`, `.order()`, `.single()`, `.maybeSingle()`, `.limit()`, and `.range()`, but not the full Supabase feature surface.

### Generic REST access is allowlisted

If a frontend change starts reading or writing a new table through `supabase.from(...)`, that table must be added to `ALLOWED_TABLES` in `server/routes/generic.js` or the request will be rejected.

### Server-side normalization is intentional

`server/routes/generic.js` does important normalization before writes:

- ISO datetime strings are converted to MySQL datetime format.
- Money-like fields are parsed and rounded with validation.
- Product and selling-unit pricing fields are normalized.
- POS customer price levels are normalized to `Retail`, `Wholesale`, or `Special`.

Frontend code should send ISO strings and normal business values; do not pre-format MySQL datetimes manually.

### Business-critical writes belong in RPC routes

Anything that must be atomic or must keep multiple ledgers in sync should go through `server/routes/rpc.js`, not ad hoc frontend CRUD. Live RPCs include:

- POS: `open_pos_shift`, `close_pos_shift`, `post_sale`, `post_z_reading`, `void_sale`, `post_return`, `reset_z_reading`, `post_pos_cash_pickup`
- Inventory / AP: `post_receiving`, `create_payable_from_receiving`, `issue_stock_transfer`, `receive_stock_transfer`, `bulk_import`
- Finance: `deduct_bank_balance`, `add_bank_balance`, `sync_daily_sales_from_pos`
- Search helpers: `search_products`, `search_stock_balances`, `search_customers`

### Inventory balances are derived through movement-aware flows

`inventory_balances` stores the running `(product_id, location_id)` quantity, and every real stock mutation should also create an `inventory_movements` row. Avoid directly setting `qty_on_hand` from the frontend. Receiving, sales, transfers, and similar stock-changing actions are expected to go through RPC handlers so balances and movement history stay aligned.

### Some tables do not use `id` as the primary key

The main exceptions are:

- `pos_shifts` -> `shift_id`
- `sales` -> `sale_id`
- `sale_items` -> `item_id`
- `sale_payments` -> `payment_id`
- `held_sales` -> `held_sale_id`
- `pos_terminals` -> `terminal_id`

The generic insert handler already knows about these when returning inserted rows.

### Auth, session, and routing behavior are role-driven

- Roles are `admin` and `staff`.
- Staff are redirected to `/gcash`; admins default to `/dashboard`.
- Admin-only screens are wrapped with `<AdminRoute>` in `src/App.tsx`.
- `AuthContext` loads the session through the local adapter, fetches the matching `profiles` row, and refreshes `last_login` on sign-in.

### Prefer the shared UX and utility helpers

- Use `useToast()` from `src/contexts/ToastContext` for user-visible feedback.
- Use `useAuth()` from `src/contexts/AuthContext` for the current user/profile/session.
- Use `formatCurrency`, `formatDate`, `formatDateTime`, `round2`, and `toNum` from `src/lib/utils.ts` for PHP and `en-PH` formatting behavior.

### Audit logging is best-effort

Use `writeAuditLog(userId, action, module, recordId?, details?)` from `src/lib/audit.ts` for meaningful mutations. It intentionally swallows failures so audit logging never blocks the primary operation.

### GCash rollover changes future balances

`src/lib/rollover.ts` is the day-close path for GCash accounts. `postDailyHistory()` both writes/updates the `daily_history` row and advances the account's beginning/running balance. `processMissedRollovers()` is used to backfill skipped days on login, so changes around closed-vs-open transactions should account for `is_closed`.

### POS session flow has a few non-obvious rules

- Shift open creates an `open` row in `pos_shifts` tied to a terminal and business date.
- The fullscreen session page works from the `shift_id` route param.
- Checkout pre-checks stock on the frontend, then posts the sale through RPC so stock deduction, movement logging, sale items, and payments are committed together.
- Holding a cart writes `held_sales` and `held_sale_items`; recall deletes the hold and reloads the cart from that snapshot.
- Split payments replace the single initial payment row inserted during sale posting.

### Environment variables live in the project root `.env`

```text
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
JWT_SECRET
VITE_API_URL=http://localhost:4000
VITE_APP_URL=http://localhost:5173
API_PORT=4000
```
