# Near Real-Time Data Synchronization System

A production-grade, multi-tenant data synchronization engine built with **Node.js (TypeScript)**, **PostgreSQL**, and **Docker**. The system synchronizes data between client (local/desktop) and cloud (remote) databases using watermark-based delta querying, Last-Write-Wins (LWW) conflict resolution with critical override rules, and a Dead Letter Queue for rejected updates.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup & Installation](#setup--installation)
- [Running the Application](#running-the-application)
- [Running Tests](#running-tests)
- [Database Schema](#database-schema)
- [Core Engine Logic](#core-engine-logic)
- [Conflict Resolution Rules](#conflict-resolution-rules)
- [Multi-Tenant Architecture](#multi-tenant-architecture)
- [Frontend Dashboard](#frontend-dashboard)
- [Git Commit History](#git-commit-history)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SyncEngine                               │
│  ┌───────────────┐   ┌──────────────────┐   ┌───────────────┐  │
│  │ Watermark Mgr │   │ Delta Querying   │   │ Conflict Res. │  │
│  │ (per tenant)  │──▶│ (per data type)  │──▶│ (LWW + DLQ)   │  │
│  └───────────────┘   └──────────────────┘   └───────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │            Multi-Tenant Concurrent Intervals             │   │
│  │  Tenant A: [ref: 60s] [txn: 5s]                         │   │
│  │  Tenant B: [ref: 60s] [txn: 5s]                         │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │client_records│ │cloud_records │ │dead_letter_  │
  │  (Local DB)  │ │  (Remote DB) │ │  queue (DLQ) │
  └──────────────┘ └──────────────┘ └──────────────┘
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                  ┌─────────────────┐
                  │sync_watermarks  │
                  │ (Cursor State)  │
                  └─────────────────┘
```

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Runtime    | Node.js with TypeScript             |
| Database   | PostgreSQL 15 (via Docker)          |
| ORM/Driver | `pg` (node-postgres) — raw SQL      |
| Testing    | Jest + `pg-mem` (in-memory PG)      |
| Container  | Docker Compose                      |
| Frontend   | React (Vite) + Tailwind CSS v4      |

---

## Project Structure

```
CareEco/
├── docker-compose.yml          # 1-click PostgreSQL 15 setup
├── README.md                   # This file
│
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   └── src/
│       ├── db/
│       │   └── init.ts         # Database schema migration script
│       ├── SyncEngine.ts       # Core synchronization engine
│       ├── SyncEngine.test.ts  # Automated Jest test suite
│       └── server.ts           # Express API for dashboard data
│
└── frontend/
    ├── package.json
    ├── postcss.config.js
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── index.css           # Tailwind CSS entry
        └── App.jsx             # React visualization dashboard
```

---

## Prerequisites

- **Node.js** v18+ and **npm**
- **Docker** and **Docker Compose** (for the PostgreSQL database)

---

## Setup & Installation

### 1. Clone the repository

```bash
git clone https://github.com/sidharthaxy/CareEco.git
cd CareEco
```

### 2. Start the PostgreSQL database

```bash
docker compose up -d
```

This starts a PostgreSQL 15 container (`sync_db`) on port `5432` with:
- **User:** `user`
- **Password:** `password`
- **Database:** `sync_db`

### 3. Install backend dependencies

```bash
cd backend
npm install
```

### 4. Initialize the database schema

```bash
npx ts-node src/db/init.ts
```

This creates the four core tables: `client_records`, `cloud_records`, `dead_letter_queue`, and `sync_watermarks`.

### 5. Install frontend dependencies

```bash
cd ../frontend
npm install
```

---

## Running the Application

### Start the backend API server

```bash
cd backend
npx ts-node src/server.ts
```

The Express server starts on `http://localhost:3000` and exposes:
- `GET /api/data` — Returns mock data for the three database tables.

### Start the frontend dashboard

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser to see the visualization dashboard.

---

## Running Tests

The test suite uses `pg-mem` (an in-memory PostgreSQL emulator) so **no running database is required** to execute tests.

```bash
cd backend
npx jest --verbose
```

**Expected output:**

```
PASS src/SyncEngine.test.ts
  SyncEngine
    ✓ should only sync records modified after watermark
    ✓ should resolve conflicts using Last-Write-Wins by default
    ✓ should override LWW and route to DLQ if desktop flags as critical
    ✓ should sync reference data and transactional data independently

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

### What Each Test Proves

| Test Case | What It Validates |
|-----------|-------------------|
| **Watermark sync** | Only records with `last_modified_at > watermark` are fetched. Old records are excluded. |
| **LWW default** | When two records conflict, the one with the newer timestamp wins and is synced. |
| **Critical desktop override** | A desktop record flagged `is_critical = true` overrides a newer mobile record. The rejected mobile record is routed to the Dead Letter Queue with a reason. |
| **Independent data syncing** | Reference data and transactional data run on separate intervals. Transactional syncs more frequently than reference. |

---

## Database Schema

All tables use **composite primary keys** `(tenant_id, id)` for multi-tenant data isolation.

### `client_records` / `cloud_records`

| Column            | Type                     | Description                          |
|-------------------|--------------------------|--------------------------------------|
| `id`              | `UUID`                   | Record identifier                    |
| `tenant_id`       | `UUID NOT NULL`          | Tenant isolation key                 |
| `payload`         | `JSONB NOT NULL`         | Flexible data payload                |
| `data_type`       | `VARCHAR(50) NOT NULL`   | `'reference'` or `'transactional'`   |
| `last_modified_at`| `TIMESTAMPTZ NOT NULL`   | Last modification timestamp          |
| `modified_by`     | `VARCHAR(50) NOT NULL`   | `'desktop'` or `'mobile'`            |
| `is_critical`     | `BOOLEAN DEFAULT false`  | Critical flag for desktop overrides  |

### `dead_letter_queue`

Same as above, plus:

| Column        | Type                   | Description                     |
|---------------|------------------------|---------------------------------|
| `reason`      | `TEXT NOT NULL`        | Why the record was rejected     |
| `rejected_at` | `TIMESTAMPTZ`          | When the rejection occurred     |

### `sync_watermarks`

| Column        | Type                   | Description                     |
|---------------|------------------------|---------------------------------|
| `id`          | `VARCHAR(50)`          | Watermark identifier (e.g. `reference_sync`) |
| `tenant_id`   | `UUID NOT NULL`        | Tenant isolation key            |
| `last_sync_at`| `TIMESTAMPTZ`          | Cursor timestamp for delta queries |

---

## Core Engine Logic

### Delta Querying (Watermark-Based)

The `SyncEngine` uses a **watermark pattern** to avoid full-table scans:

1. Read the current watermark for a given `(tenant_id, data_type)`.
2. Query only records where `last_modified_at > watermark`.
3. After successful sync, advance the watermark to the highest processed timestamp.

This ensures each sync cycle only processes **new or modified records** since the last sync.

### Data Type Segregation

Data is classified into two categories with **independent sync intervals**:

| Data Type       | Default Interval | Use Case                                      |
|-----------------|------------------|-----------------------------------------------|
| **Reference**   | 60 seconds       | Slowly changing data (config, master lists)    |
| **Transactional**| 5 seconds       | Rapidly changing data (orders, events)         |

Each type runs its own `setInterval`, so transactional data syncs 12x more frequently than reference data.

---

## Conflict Resolution Rules

When the same record (`id`) is modified on both client and cloud sides within the same sync window, the engine applies these rules **in order**:

### Rule 1: Last-Write-Wins (LWW) — Default

The record with the **more recent `last_modified_at` timestamp** wins. The losing record is overwritten.

### Rule 2: Critical Desktop Override — Exception

If a **desktop** record is flagged with `is_critical = true` and the conflicting record is from **mobile**, the desktop record **always wins** regardless of timestamps. The rejected mobile record is routed to the Dead Letter Queue.

### Rule 3: Dead Letter Queue (DLQ) Routing

Rejected records are **never silently dropped**. They are inserted into the `dead_letter_queue` table with:
- The full original payload
- A human-readable `reason` (e.g., `"Mobile update rejected due to critical desktop override"`)
- A `rejected_at` timestamp

```
Conflict Detected (same record ID modified on both sides)
        │
        ▼
  Is desktop record critical AND opponent is mobile?
        │
    ┌───┴───┐
   YES      NO
    │        │
    ▼        ▼
 Desktop   Compare timestamps
  wins     (LWW: newer wins)
    │        │
    ▼        ▼
 Mobile    Loser is
 → DLQ     overwritten
```

---

## Multi-Tenant Architecture

Every table includes a `tenant_id` column and uses composite primary keys `(tenant_id, id)`. This provides:

- **Complete data isolation** — Tenant A's sync never reads or writes Tenant B's data.
- **Independent watermarks** — Each tenant tracks its own sync cursor per data type.
- **Concurrent sync pipelines** — `startSyncIntervals(tenantIds)` spins up separate `setInterval` loops per tenant. All tenants sync concurrently without blocking each other.

---

## Frontend Dashboard

The React + Tailwind CSS v4 dashboard at `http://localhost:5173` provides a side-by-side visualization of:

| Panel                  | What It Shows                                                     |
|------------------------|-------------------------------------------------------------------|
| **Client Records**     | The winning desktop record written to the local client database   |
| **Cloud Records**      | Older cloud data or newly synced winning records                  |
| **Dead Letter Queue**  | Rejected mobile updates with reason and critical flag indicators  |

The dashboard displays:
- Color-coded badges for `desktop` (blue) and `mobile` (purple) sources
- ⭐ **Critical** flags highlighted in red
- ❌ DLQ rejection reasons
- ✅ Sync status indicators

---
## AI disclamer
AI was used for the initialization of the project,bug fixes ,test case generation and readme writting.