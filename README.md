# Faatix — Business System

Faatix is a multi-business management system (Somali & English): a public website plus a
secure business application where each registered business manages only its own data. Built with:

| Part      | Tech                          | Folder       | Runs on                 |
|-----------|-------------------------------|--------------|-------------------------|
| Frontend  | React 18 + Vite + React Router| `client/`    | http://localhost:5173   |
| Backend   | Node.js + Express             | `server/`    | http://localhost:5000   |
| Database  | MySQL (XAMPP)                 | `database/`  | localhost:3306          |

## How it runs

![How the Faatix system runs](docs/faatix-flowchart.png)

## Requirements

- **Node.js** 18 or newer — https://nodejs.org
- **MySQL** — easiest via **XAMPP** (https://www.apachefriends.org). Only MySQL is needed, not Apache.
- **VS Code** (recommended) to open the folder and use its terminal.

## First-time setup

1. Open the project folder in VS Code and open a terminal (**Terminal → New Terminal**).
2. Install everything:
   ```
   npm run install:all
   ```
3. Create the server settings file (skip if `server/.env` already exists):
   ```
   copy server\.env.example server\.env
   ```
   The defaults match XAMPP (user `root`, no password). Change `DB_PASSWORD` if yours has one.
4. Start MySQL: open the **XAMPP Control Panel** and click **Start** next to **MySQL**.
5. Create the database:
   ```
   npm run db:init
   ```

## Run the project (every day)

1. Start **MySQL** in the XAMPP Control Panel.
2. In the VS Code terminal, from the project folder:
   ```
   npm run dev
   ```
3. Open **http://localhost:5173** in your browser.

`npm run dev` starts both the API (green `[api]` logs) and the website (cyan `[web]` logs).
Stop with **Ctrl + C**.

Check the API and database: http://localhost:5000/api/health

## Production build

```
npm run build     # installs server + client packages, builds client/dist
npm start         # Node serves the API and the built site on http://localhost:5000
```

Locally, `npm run build:client` only rebuilds the website (no reinstall).

## Deploy on Railway

1. **New project → Deploy from GitHub repo** and pick this repository. Railway runs
   `npm ci`, `npm run build` and `npm start` (from `package.json`) — no extra settings needed.
2. **Add a MySQL database** to the same project (**+ New → Database → MySQL**).
3. In the Faatix service open **Variables** and add:
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = a long random text (at least 32 characters) — the app refuses to start without it
   - Database: click **Add Variable Reference** and add `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`,
     `MYSQLPASSWORD`, `MYSQLDATABASE` from the MySQL service (or just `MYSQL_URL`).
4. **Settings → Networking → Generate Domain** to get the public https address.
5. Deploy. On the first start the server creates all database tables by itself
   (log line: `Database set up: created all tables`).
6. **Uploaded logos and product photos** are stored in the MySQL database, so they survive
   redeploys — no Volume needed.

Optional sample data (users from the table below): open a shell inside the running
service with the Railway CLI (`railway ssh`) and run `npm run db:seed`.
On a real business server, change the sample passwords or skip the seed.

## Project structure

```
client/           the business app + super admin (opens on /signin)
  src/
    assets/       faatix-logo.png, faatix-logo-light.png
    components/   Logo, LanguageSwitch, Icon (shared UI pieces)
    pages/        SignIn, NotFound, OnlineOrder
    auth/         AuthContext.jsx (signed-in user + business, RequireAuth)
    app/          AppLayout, Dashboard, ModulePage, InvoiceView, ui.jsx, pages/ (one file per module)
    admin/        AdminApp.jsx and the super admin pages
    i18n/         translations.js + appStrings.js (all EN/SO text), LanguageContext.jsx
    services/     api.js, authService.js
    styles/       styles.css (sign-in / shared), app.css + modules.css (business app)
faatix-website/   the public marketing website — a separate Vite project (see its README)
  static-version/ the earlier plain-HTML website, kept for reference
server/
  src/
    config/       env.js, db.js (MySQL pool), migrate.js
    middleware/   auth.js (session check, roles, audit log)
    routes/       auth, dashboard, products, sales, invoices, purchases, parties, money, reports, account, admin …
    scripts/      initDb.js, seedSample.js, adminPassword.js
database/
  schema.sql      creates the `faatix` database with all tables (safe to re-run)
server/uploads/   uploaded business logos (not committed to git)
```

## App and website

- **The app** (`client/`) starts on the sign-in page: `/` → `/signin`. After signing in, the business
  application lives under `/app`; the super admin area is `/admin`.
- **Self sign-up is closed.** Businesses are registered by Faatix in the super admin area.
  `POST /api/auth/register` answers `403 registrationClosed` (set `ALLOW_SELF_SIGNUP=true` to turn it back on for a local demo).
- **The website** (`faatix-website/`) is its own project: `npm run dev:website` (http://localhost:5174),
  `npm run build:website`. "Request a demo" opens its contact form, which lands in
  Super admin → Support → Website messages (with the business name). "Sign in" opens the app.
- Environment: the website uses `VITE_API_URL` and `VITE_APP_URL`; the API allows the website's origin(s) on
  `/api/contact` only, via `WEBSITE_ORIGIN` (comma separated); the app may set `VITE_WEBSITE_URL` so its sign-in page
  links back to the website.
- Website text, images and contact placeholders now live in `faatix-website/src` (`config/site.js`, `public/images`).

## Editing text and translations

All text lives in `client/src/i18n/translations.js` under `en` and `so`.
The chosen language is remembered in the browser; `?lang=so` in a URL forces Somali.

## Business application (what works now)

- **Registration** (`/register`): business details, optional logo (PNG/JPG/WEBP, max 2 MB,
  checked on the server), owner account. Saved in one database transaction: business, owner
  user (password hashed with bcrypt), owner role, settings, a default cash account and a
  15-day trial record.
- **Sign in** with username, email or phone. Sessions are an httpOnly, SameSite=Strict cookie
  (7 days). Login attempts are rate-limited (10 per 15 minutes).
- **Data isolation**: every business query filters by the signed-in user's `business_id` on
  the server. Asking for another business's record returns "not found".
- **Dashboard** (`/app`): totals for today / this week / this month / this year / custom dates,
  calculated from real records only (empty states when there is no data). Definitions are
  documented at the top of `server/src/routes/dashboard.js`.
- **Invoices**: `/app/invoices/:id` shows a printable invoice (Print / Save as PDF) with the
  Faatix logo in the header and "Powered by Faatix" in the footer, plus the business logo and
  details. `/app/invoices/preview` shows the layout with clearly-marked sample lines.
- **Somali / English** across the whole app; the choice is saved on the user's account.

## Modules

| Module | Where | Notes |
|---|---|---|
| POS | `/app/m/pos` | Barcode search (Enter), cart, discount, cash / mobile money / bank / credit, change, printable receipt with the Faatix logo, cancel & refund |
| Invoices | `/app/m/invoices`, `/app/invoices/new` | Retail or wholesale prices, due dates, partial payments, overdue status, cancel (unpaid only) |
| Products | `/app/m/products` | Brand, category, subcategory, unit list, Low Stock Alert Level, photos, barcode check (no duplicates), filters, sorting, pages, CSV import/export |
| Stock management | `/app/m/stock` | Locations (shops / warehouses), current stock, opening stock, add stock (scan many products), adjust (quantity or verified count, with preview), transfers, movement ledger with reversals, low stock, valuation, stock reports |
| Customers / Suppliers | `/app/m/customers`, `/app/m/suppliers` | Balances, statements, payments (allocated oldest-first) |
| Purchases | `/app/m/purchases` | Receive stock, updates cost price, supplier payments |
| Expenses & income | `/app/m/expenses` | Categories, totals by category |
| Cash & bank | `/app/m/cash` | Cash, mobile money and bank accounts, transfers, cashbook |
| Reports | `/app/m/reports` | Sales, profit, inventory, low stock, receivables, payables, purchases, expenses, cash flow, best sellers (CSV + print) |
| Staff & roles | `/app/m/staff` | Owner, manager, cashier, stockkeeper (permissions enforced on the server) |
| Settings, business info, profile, subscription, activity log | `/app/m/...` | Logo, currency, invoice prefix/footer, language |
| Notifications | bell in the top bar | Low/out of stock, invoices due/overdue, supplier balances |
| Super Admin | `/admin` | Platform overview, all businesses, suspend / activate with a reason, platform audit log |

## Sample data and users

```
npm run db:seed            # adds the sample business (safe to re-run)
npm run db:seed -- --reset # deletes and recreates the sample business
```

Database name: **`faatix`**. The sample business is "Hodan Supermarket (SAMPLE)".

| Role | Username | Password | Sign in at |
|---|---|---|---|
| Owner | `hodan` | `Faatix@2026` | `/signin` |
| Manager | `manager1` | `Manager@2026` | `/signin` |
| Cashier | `cashier1` | `Cashier@2026` | `/signin` |
| Stockkeeper | `stock1` | `Stock@2026` | `/signin` |
| Super Admin | `superadmin` | `Admin@2026` | `/admin/signin` |

Change these passwords (or don't run the seed) on any real server.

## Not built yet

Partial returns (only whole-sale cancellation), payment plans, password reset by email,
online subscription payments, and deployment documentation. The Somali text should be
reviewed by a native speaker.
