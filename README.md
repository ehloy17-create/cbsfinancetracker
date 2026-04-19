# Local MySQL Setup Guide

This project has been migrated from Supabase to a **local MySQL + Express.js** stack.

---

## Architecture

```
React (Vite)  ──►  Express API (port 4000)  ──►  MySQL (port 3306)
src/lib/supabase.ts    server/index.js              gcash_pos
```

The frontend code is **unchanged**. `src/lib/supabase.ts` now contains a
drop-in replacement client that routes all requests to your local Express server
instead of Supabase.

---

## Prerequisites

- Node.js v18+
- MySQL 8.0+ running locally
- A MySQL user with CREATE/INSERT/UPDATE/DELETE privileges

---

## One-time setup

### 1. Create the database
```sql
CREATE DATABASE gcash_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Run the schema
```bash
mysql -u root -p gcash_pos < server/schema.sql
```

### 3. Configure .env
Edit `.env` in the project root — set DB_PASSWORD and JWT_SECRET at minimum.

### 4. Install server dependencies
```bash
cd server && npm install && cd ..
```

### 5. Create the first admin user
Edit `server/seed-admin.js` to set your email/password, then:
```bash
cd server && node seed-admin.js && cd ..
```

### 6. Install frontend dependencies
```bash
npm install
```

---

## Running the app

**Terminal 1 — API server:**
```bash
cd server && npm run dev
```

**Terminal 2 — Frontend:**
```bash
npm run dev
```

Open one of:

- `http://localhost:5173`
- `http://<host-lan-ip>:5173` from another device on the same LAN

The dev API listens on `0.0.0.0:4000`, and the Vite dev server also binds to `0.0.0.0`, so LAN clients use the same host IP with the frontend port while API calls resolve to `http://<same-host>:4000`.

### VS Code auto-start
Opening this folder in Visual Studio Code now starts both dev servers automatically through the workspace task **Start app servers**. If VS Code still prompts you the first time, allow automatic tasks for this workspace.

---

## Project structure

```
project/
├── .env                     ← database + JWT config
├── src/lib/supabase.ts      ← ⭐ local API adapter (replaces Supabase SDK)
└── server/
    ├── schema.sql           ← full MySQL schema (run once)
    ├── seed-admin.js        ← creates first admin (run once)
    ├── index.js             ← Express entry point (port 4000)
    ├── db.js                ← MySQL pool
    ├── middleware/auth.js   ← JWT middleware
    └── routes/
        ├── auth.js          ← login / logout / register
        ├── profiles.js      ← profile CRUD
        ├── generic.js       ← REST CRUD for all 45 tables
        └── rpc.js           ← post_sale, post_receiving,
                                issue/receive_stock_transfer,
                                deduct/add_bank_balance,
                                create_payable_from_receiving
```

---

## Troubleshooting

- **Access denied** — Check DB_USER/DB_PASSWORD in `.env`
- **CORS error** — Make sure `VITE_API_URL` is either unset or points at the host machine API URL
- **Table not found** — Re-run `mysql ... < server/schema.sql`
- **Login fails** — Run `node server/seed-admin.js`

---

## Windows deployment installer

This project now includes a Windows packaging flow for a local installable deployment.

### Deployment architecture

- **Frontend:** React + Vite production build in `dist\`
- **Backend:** Express API serving both `/api`-style routes and the built SPA
- **Database:** bundled **MariaDB Windows ZIP** runtime installed as a local Windows service
- **App launcher:** bundled **Node.js Windows runtime** starts the local API server and opens the app in the default browser

### Runtime behavior on target machines

After install:

1. MariaDB is initialized locally and registered as a Windows service
2. The database `gcash_pos` is created automatically if missing
3. `server\schema.sql` is applied automatically if the base schema is missing
4. A default admin user is created only if no admin exists
5. A desktop and Start Menu shortcut launch the local app
6. A Windows Firewall rule is added for the app port on **Domain/Private** profiles for **LocalSubnet** only

### Target-machine storage paths

The installed runtime stores mutable data outside the install folder:

- **App data root:** `%ProgramData%\BizTracker`
- **Runtime env/config:** `%ProgramData%\BizTracker\config\app.env`
- **MariaDB data:** `%ProgramData%\BizTracker\mariadb-data`
- **API logs:** `%ProgramData%\BizTracker\logs`

Older installs that were initialized under `%ProgramData%\GCashPOSLocal` or `%LOCALAPPDATA%\GCashPOSLocal` are still detected during startup, but new installs and reinstalls use the machine-wide `%ProgramData%\BizTracker` location so the app works regardless of which administrator account ran setup.

### LAN access behavior

- The installed app server listens on `0.0.0.0:4010`
- The bundled launcher still health-checks via loopback, but opens the browser on the preferred LAN URL when a private IPv4 address is available
- Other devices on the same Wi-Fi/LAN can use `http://<host-lan-ip>:4010`
- MariaDB remains local to the host machine on `127.0.0.1:3307`

If you need a fixed hostname or IP for generated share links, add this optional line to `%ProgramData%\BizTracker\config\app.env`:

```text
APP_PUBLIC_BASE_URL=http://192.168.1.50:4010
```

### Default seeded admin

If no admin exists yet, the installer/runtime seed uses:

- **Email:** `admin@example.com`
- **Password:** `admin123`

Change this password after first login.

### Build-machine prerequisites

Before creating the installer, place the unpacked portable runtimes here:

- `deploy\vendor\node-runtime\` → must contain `node.exe`
- `deploy\vendor\mariadb-runtime\` → must contain `bin\mariadb-install-db.exe`

See `deploy\vendor\README.txt`.

### Build commands

From the project root:

```bash
npm run build
npm run deploy:stage
npm run deploy:installer
```

### LAN testing checklist

1. Find the host machine IP with `ipconfig`
2. Start the app on the host machine
3. Open `http://<host-lan-ip>:4010` from another device on the same LAN
4. If you are running the source project instead of the installed app:
   - frontend dev URL: `http://<host-lan-ip>:5173`
   - backend API URL: `http://<host-lan-ip>:4000`
5. If another device cannot connect, allow inbound TCP on the app port in Windows Firewall for **Private** networks

### What the deployment scripts do

- `npm run build`
  - builds the Vite frontend for production
- `npm run deploy:stage`
  - rebuilds the frontend with same-origin API settings
  - copies the frontend build, server runtime, portable Node runtime, portable MariaDB runtime, and installer scripts into `release\windows-installer\app`
- `npm run deploy:installer`
  - compiles `deploy\windows\installer.iss` with Inno Setup

### Installer behavior

The installer:

- copies the staged app payload into `Program Files`
- runs `install-db.ps1`
- creates the MariaDB service
- writes the production runtime config
- initializes the database/schema/admin seed
- creates desktop and Start Menu shortcuts

### Backups and restore

**Backup**

Back up the whole folder:

```text
%ProgramData%\BizTracker
```

At minimum, back up:

- `mariadb-data\`
- `config\app.env`

**Restore**

1. Install the same app version (or a compatible newer version)
2. Stop the MariaDB service if it is running
3. Restore the backed-up `%ProgramData%\BizTracker` folder
4. Start the app again from the desktop/start menu shortcut

### Quick app-only update for existing installs

If BizTracker is already installed on a Windows PC and you only want to replace it with the latest build:

1. Run `npm run deploy:stage`
2. Copy the staged folder `release\windows-installer\app` to the target machine
3. On the target machine, open that folder and run `update-installed.cmd` as Administrator
4. The script updates the installed files in `Program Files\BizTracker` and preserves `%ProgramData%\BizTracker`

This is intended for fast in-place upgrades without uninstalling or resetting the local database.

### Future updates

- keep `%ProgramData%\BizTracker` intact during updates
- use `update-installed.cmd` from the latest staged app for quick in-place upgrades
- reinstall the new app version over the old install folder if you want the full installer flow

---

## Git upload and cloud deployment

This repo is now prepared for Git-based cloud deployment.

### Safe to upload to Git

The `.gitignore` excludes:

- local `.env` secrets
- `node_modules`
- Windows release bundles and logs
- portable installer runtimes used only for Windows packaging

### Cloud-ready files

- `Dockerfile` — production container build
- `.dockerignore` — smaller, cleaner image builds
- `.env.example` — required environment variables
- `render.yaml` — sample Render web service config

### Recommended cloud setup

Use **one Node web service** plus an **external MySQL database**.
The Express server serves the built Vite frontend from the same app.

### Required environment variables

Set these in your cloud dashboard:

```text
NODE_ENV=production
API_HOST=0.0.0.0
PORT=10000
DB_HOST=your-mysql-host
DB_PORT=3306
DB_USER=your-mysql-user
DB_PASSWORD=your-mysql-password
DB_NAME=gcash_pos
JWT_SECRET=replace-with-a-long-random-secret
APP_PUBLIC_BASE_URL=https://your-app-domain
VITE_APP_URL=https://your-app-domain
VITE_API_URL=
```

### Generic deploy flow

1. Push this project to GitHub
2. Create a new web service on your cloud provider
3. Deploy from the repo root using the included `Dockerfile`
4. Add the environment variables above
5. Point the app to a managed MySQL instance
6. Open `/health` after deploy to confirm the service is live

### Build behavior in cloud

The app now supports provider-managed ports such as `PORT`, which is required by most cloud platforms.
Cloud/Linux runtime data falls back to a Linux-safe app data folder automatically.

- the runtime initialization will preserve the existing DB and only apply missing schema at startup
