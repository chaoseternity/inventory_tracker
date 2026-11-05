# Inventory Tracker — Full-Stack Equipment & Asset Management

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Cloudflare Workers & D1](https://img.shields.io/badge/Cloudflare-Workers%20%26%20D1-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Jest-420%2B%20Passing-brightgreen?logo=jest)](https://jestjs.io/)

A modern, full-stack equipment inventory, checkout, reservation, and asset tracking platform.

Inventory Tracker manages hardware, production gear, cameras, audio kits, lenses, tools, accessories, and laptops with automated audit workflows, peer-to-peer equipment handovers, dedicated kiosk NFC scanning, interactive storage mapping, and an AI-powered Standard Operating Procedure (SOP) assistant.

---

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [Hardware & Scanner Integration](#hardware--scanner-integration)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start / Local Setup](#quick-start--local-setup)
- [Environment Variables](#environment-variables)
- [User Roles & Permissions (RBAC)](#user-roles--permissions-rbac)
- [Database Management & Migrations](#database-management--migrations)
- [NFC Kiosk Station Setup](#nfc-kiosk-station-setup)
- [Available Scripts](#available-scripts)
- [Deployment Guide](#deployment-guide)
  - [Cloudflare Workers + D1 (Production)](#cloudflare-workers--d1-production)
  - [Vercel + PostgreSQL (Alternative)](#vercel--postgresql-alternative)
- [Project Directory Structure](#project-directory-structure)

---

## Core Capabilities

- **Equipment Catalog & Asset Tracking**: Complete equipment directory with category filters, condition statuses, storage locations, serial numbers, and custom tag hierarchies.
- **Checkouts & Self-Service Returns**: Fast checkouts with due dates, overdue detection, automatic email return reminders, and self-service return workflows.
- **Peer-to-Peer Handovers (`HD-XXXXXX`)**: Transfer custody directly between team members on location via single-use 6-digit claim codes or QR codes without returning gear to the central locker.
- **Equipment Reservations & Conflict Detection**: Pre-book gear for upcoming events, shoots, and sessions with automated overlap checking.
- **Interactive Storage Map (`/dashboard/map`)**: Visual 2D grid editor of storage cabinets, shelves, and lockers, showing which gear is stored in which slot.
- **Stock Audits & Roll Calls (`/dashboard/audit`)**: Live multi-user stock verification allowing admins to scan all assets with real-time "exists vs. missing" tallies.
- **Event Team Deployments & Rehearsals**: Group equipment bundles by event sections (e.g., Live Stream, Photography, Audio) with RSVP deployment invites.
- **AI-Powered SOP Assistant**: Powered by Google Gemini (`@google/generative-ai`), parses uploaded technical SOPs (PDF/Word) and provides multimodal assistant guidance for gear operations and troubleshooting.
- **Printable Barcodes & Asset Tags**: Generates standard 1D Code128 asset labels and 2D QR codes ready for printing and pasting onto equipment.
- **Progressive Web App (PWA) & Offline Resilience**: Service worker support with background synchronization (`lib/offlineSync.ts`) to queue transactions during weak Wi-Fi connectivity.

---

## Hardware & Scanner Integration

Inventory Tracker is built from the ground up to support physical hardware scanners:

1. **In-Browser Smartphone Camera Scanner**:
   - Zero-delay transparent `onPointerDown` tap layer for instant tap-to-focus.
   - Targeting reticle with real-time focus feedback (`Refocusing…` → `Focused ✓`).
   - Hardware Phase-Detection Autofocus (PDAF) kick via momentary micro-zoom nudge.
   - Macro zoom presets (`[1x] [2x] [3x]`) designed for scanning small 1D barcodes from 15–20 cm away.
   - Built-in flashlight/torch toggle.
2. **USB & Bluetooth Barcode Guns**:
   - Global keystroke buffer captures rapid scanner input (`<50ms` key intervals) on all dashboard pages without requiring input focus.
3. **NFC Card Readers (Dedicated Station)**:
   - Web NFC / PC/SC card readers (e.g., ACS ACR122U) paired with `/dashboard/nfc` for fast badge-in/badge-out checkouts.

---

## Architecture & Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack, React 19, TypeScript 5)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with Radix / Base UI and [Lucide Icons](https://lucide.dev/)
- **Authentication**: [NextAuth.js v5](https://authjs.dev/) supporting:
  - Microsoft Entra ID / Azure AD (organizational accounts)
  - Google OAuth
- **Database Layer**:
  - **Edge / Serverless**: [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite distributed across Cloudflare edge) via OpenNext.
  - **Local Dev & Testing**: In-memory / local SQLite via `better-sqlite3`.
  - **Relational Fallback**: PostgreSQL support on the `vercel` branch.
- **AI & Multimodal Vision**: Google Gemini API (`gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`).
- **Email Delivery**: SMTP via Nodemailer with daily Cloudflare Cron Triggers for overdue notifications.
- **Testing**: [Jest](https://jestjs.io/) 30 with `@testing-library/react` (420+ automated unit, component, and smoke tests).

---

## Prerequisites

- **Node.js**: `v20.18.0` or higher (Node 22 recommended)
- **Package Manager**: `npm` (comes with Node.js)
- **Cloudflare Account & Wrangler** (optional, for Cloudflare D1 deployments):
  ```bash
  npm install -g wrangler
  wrangler login
  ```

---

## Quick Start / Local Setup

### 1. Clone the repository
```bash
git clone https://github.com/chaoseternity/inventory-tracker.git
cd inventory-tracker
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env.local` file in the project root:
```bash
cp .dev.vars.example .env.local
```
Fill in the required authentication secrets (see [Environment Variables](#environment-variables)).

### 4. Initialize local database
For local development with Cloudflare D1 local simulation:
```bash
# 1. Apply schema migrations to local D1 instance
npm run db:migration:local

# 2. Seed mock equipment, tags, and users
npm run seed
npm run db:seed:local
```

### 5. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

| Variable | Description | Required? | Example / Default |
| :--- | :--- | :---: | :--- |
| `AUTH_SECRET` | Secret key used by NextAuth to sign session tokens. Generate with `openssl rand -base64 32`. | **Yes** | `d4e5f...` |
| `AUTH_URL` | Canonical URL of your deployment. | **Yes** | `http://localhost:3000` (Local) / `https://inventory-tracker.example.com` (Prod) |
| `AZURE_AD_CLIENT_ID` | Microsoft Entra ID App registration Client ID. | Optional | `00000000-0000-0000-0000-000000000000` |
| `AZURE_AD_CLIENT_SECRET` | Microsoft Entra ID App registration Client Secret. | Optional | `secret...` |
| `AZURE_AD_TENANT_ID` | Microsoft 365 Tenant ID. | Optional | `common` or tenant GUID |
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth Client ID. | Optional | `12345...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth Client Secret. | Optional | `GOCSPX-...` |
| `ADMIN_EMAILS` | Comma-separated list of emails automatically granted `admin` role on login. | **Yes** | `admin@example.com` |
| `GEMINI_API_KEY` | Google Gemini API key for AI SOP chat assistant. | Optional | `AIzaSy...` |
| `GEMINI_MODEL` | Primary Gemini model ID. | Optional | `gemini-3.5-flash-lite` |
| `SMTP_HOST` | SMTP server host for checkout reminder emails. | Optional | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port. | Optional | `587` |
| `SMTP_USER` | SMTP username / email address. | Optional | `inventory@gmail.com` |
| `SMTP_PASS` | SMTP application password. | Optional | `xxxx xxxx xxxx xxxx` |
| `SMTP_FROM` | Sender name and address for automated emails. | Optional | `"Inventory Tracker" <inventory@gmail.com>` |

---

## User Roles & Permissions (RBAC)

Inventory Tracker enforces three user permission tiers:

| Role | Access Level | Description |
| :--- | :---: | :--- |
| **`viewer`** | Read Only | Can browse equipment catalog, view item availability, and check public schedules. Cannot checkout gear. |
| **`verified`** | Member / Operator | Can checkout equipment, initiate peer handovers, submit reservations, and use the AI SOP assistant. |
| **`admin`** | Administrator | Full access: add/edit/delete equipment, approve checkouts, manage users, perform stock audits, edit storage maps, and view audit logs. |

### Promoting / Demoting Users via CLI
To change a user's role directly in the database:
```bash
# Grant Admin access
npm run set-role -- --email=admin@example.com --role=admin

# Set to Verified Member
npm run set-role -- --email=user@example.com --role=verified

# Demote to Viewer
npm run set-role -- --email=user@example.com --role=viewer
```
*(Note: Users must have logged in at least once so their profile record exists in the database).*

---

## Database Management & Migrations

Database migrations are located in [`migrations/`](migrations) and run in strict alphabetical order:

```bash
# Apply migrations locally
npm run db:migration:local

# Apply migrations to remote Cloudflare D1 production database
npm run db:migration:remote
```

### Seeding Data
The seed generator creates sample assets and checkout history:
```bash
# Generate seed SQL script
npm run seed

# Apply seed SQL to local D1 instance
npm run db:seed:local
```
> [!CAUTION]
> Seeding wipes existing equipment and checkout tables. Seeding remote production databases is blocked by default unless `--i-understand-this-wipes-production` is explicitly passed.

---

## NFC Kiosk Station Setup

For dedicated equipment sign-out desks using an attached USB NFC card reader:

1. Connect the NFC card reader to the station laptop.
2. Run the dedicated kiosk script:
   ```cmd
   launch-nfc-station.bat
   ```
   *(Or navigate directly to `/dashboard/nfc` in Google Chrome or Microsoft Edge).*
3. Users can tap their physical card or registered NFC fob to immediately pull up their active loans or check out selected gear.

---

## Available Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts the Next.js development server at `http://localhost:3000`. |
| `npm run build` | Compiles standard Next.js production build. |
| `npm run build:cf` | Builds the Cloudflare OpenNext worker bundle. |
| `npm run preview` | Runs the compiled Cloudflare OpenNext worker locally via Wrangler. |
| `npm run deploy` | Builds and deploys the app to Cloudflare Workers. |
| `npm test` | Executes all 420+ Jest tests across API routes, components, and data layers. |
| `npm run test:watch` | Runs Jest in interactive watch mode. |
| `npm run lint` | Runs ESLint checks across the entire codebase. |
| `npm run db:migration:local` | Applies SQL migration files to local Cloudflare D1 SQLite database. |
| `npm run db:migration:remote` | Applies SQL migration files to remote production Cloudflare D1 database. |
| `npm run db:seed:local` | Seeds the local SQLite database with test gear and checkouts. |
| `npm run set-role` | Updates a user's role (`admin`, `verified`, `viewer`). |

---

## Deployment Guide

### Cloudflare Workers + D1 (Production)

The production deployment runs as an edge-rendered serverless application on Cloudflare Workers backed by Cloudflare D1:

1. **Create Cloudflare D1 Database**:
   ```bash
   npx wrangler d1 create inventory-tracker-db
   ```
2. **Configure `wrangler.toml`**:
   Ensure `database_name` and `database_id` in [`wrangler.toml`](wrangler.toml) match your Cloudflare D1 instance.
3. **Apply Remote Migrations**:
   ```bash
   npm run db:migration:remote
   ```
4. **Set Production Secrets**:
   ```bash
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put AZURE_AD_CLIENT_ID
   npx wrangler secret put AZURE_AD_CLIENT_SECRET
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put SMTP_PASS
   ```
5. **Deploy**:
   ```bash
   npm run deploy
   ```

### Vercel + PostgreSQL (Alternative)

If hosting on Vercel with a standard PostgreSQL database (e.g. self-hosted on a NAS or Neon/Supabase):
1. Switch to the [`vercel`](https://github.com/chaoseternity/inventory-tracker/tree/vercel) branch:
   ```bash
   git checkout vercel
   ```
2. Configure `DATABASE_URL=postgresql://user:pass@host:5432/dbname` in Vercel project settings.
3. Deploy automatically via Vercel GitHub integration.

---

## Project Directory Structure

```text
inventory_tracker/
├── app/                        # Next.js App Router
│   ├── (auth)/login/           # Sign-in page (Azure AD / Google)
│   ├── api/                    # REST API route handlers
│   │   ├── audit/              # Stock roll-call & audit scanning APIs
│   │   ├── checkout/           # Checkouts & return processing
│   │   ├── equipment/          # Equipment CRUD & batch actions
│   │   ├── events/             # Events & asset allocations
│   │   ├── handover/           # Peer-to-peer handover verification
│   │   ├── nfc/                # NFC card assignment & card tap handling
│   │   ├── reservations/       # Equipment booking & conflict engine
│   │   ├── sop/                # SOP document parsing & Gemini AI chat
│   │   ├── storage-map/        # Cabinet layout configuration
│   │   └── cron/reminders/     # Scheduled overdue reminder email worker
│   ├── dashboard/              # Protected admin & user dashboard pages
│   │   ├── audit/              # Live stock roll call scanner
│   │   ├── events/             # Event equipment manager
│   │   ├── map/                # Interactive 2D cabinet visualizer
│   │   ├── nfc/                # Dedicated NFC Kiosk station
│   │   ├── reservations/       # Booking calendar & conflict view
│   │   ├── scan/               # Barcode & QR camera scanner
│   │   ├── sop/                # SOP manuals & AI assistant
│   │   └── users/              # User role & permission management
│   └── layout.tsx              # Root app layout & theme provider
├── components/                 # Reusable React UI components
│   ├── ui/                     # Primitives (Dialog, Button, Card, Input)
│   ├── EquipmentGrid.tsx       # Equipment card catalog view
│   ├── EquipmentModal.tsx      # Equipment detail & checkout modal
│   ├── HandoverModal.tsx       # Peer handover code claim dialog
│   ├── NFCStationClient.tsx    # NFC kiosk state machine
│   ├── PrintLabelModal.tsx     # 1D/2D printable asset tag generator
│   └── QRScannerClient.tsx     # Camera scanner with tap-to-focus & zoom
├── lib/                        # Core utilities & database abstractions
│   ├── auth.ts                 # NextAuth server configuration & helpers
│   ├── d1.ts                   # Cloudflare D1 & SQLite query interface
│   ├── db.ts                   # Domain business logic & data operations
│   ├── email.ts                # SMTP notification dispatchers
│   ├── gemini.ts               # Google Gemini AI assistant client
│   └── offlineSync.ts          # IndexedDB offline synchronization client
├── migrations/                 # D1 / SQLite database schema migrations
├── public/                     # Static assets, PWA manifest, and app icons
├── scripts/                    # CLI tools (seed generator, role management)
└── __tests__/                  # Automated test suite (Jest + React Testing Library)
```

---

## License

MIT License. Open source equipment and inventory tracking system.
