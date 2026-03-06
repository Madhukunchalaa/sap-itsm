# SAP ITSM Platform

**Production-grade, multi-tenant SAP ITSM Service Desk** — Node.js + TypeScript + PostgreSQL + Redis + React

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + TailwindCSS)          Port 3000   │
│  └─ Nginx reverse proxy → /api/* → backend                  │
├─────────────────────────────────────────────────────────────┤
│  Backend (Node.js + TypeScript + Express)       Port 3001   │
│  ├─ REST API (JWT auth, RBAC, tenant isolation)             │
│  ├─ BullMQ Workers (SLA engine, email, escalation)          │
│  └─ Prisma ORM                                              │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL 16                                  Port 5432   │
│  Redis 7                                        Port 6379   │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start (Docker)

### 1. Clone & configure
```bash
git clone <repo>
cd sap-itsm-platform
cp .env.example .env
# Edit .env — set strong passwords and JWT secrets
```

### 2. Start all services
```bash
docker compose up -d
```

### 3. Run migrations + seed
```bash
docker compose --profile migrate run migrate
```

### 4. Open the app
- **Frontend:** http://localhost:3000
- **API:**      http://localhost:3001/health
- **pgAdmin:** http://localhost:5050 (with `--profile tools`)

---

## Default Login Credentials
> Password for all accounts: `Admin@123456`

| Email                    | Role           |
|--------------------------|----------------|
| superadmin@itsm.local    | Super Admin    |
| admin@acme.com           | Company Admin  |
| agent1@acme.com          | Agent (L2)     |
| agent2@acme.com          | Agent (L3)     |
| pm@acme.com              | Project Manager|
| user@acme.com            | End User       |

---

## Local Development (without Docker)

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- Redis 7+

### Backend
```bash
cd backend
npm install
cp ../.env.example .env          # Edit DATABASE_URL, REDIS_HOST etc.
npx prisma migrate deploy
npx ts-node prisma/seed.ts
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Project Structure

```
sap-itsm-platform/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── middleware/      # auth, error, validation, tenant
│   │   │   ├── routes/          # all REST endpoints
│   │   │   └── validators/      # Zod schemas
│   │   ├── config/              # db, redis, logger, constants
│   │   ├── services/            # auth, records, sla, email
│   │   ├── workers/             # BullMQ: sla, email, escalation
│   │   └── utils/               # AppError, pagination, audit, recordNumber
│   └── prisma/
│       ├── schema.prisma        # Full normalized multi-tenant schema
│       └── seed.ts              # Demo data seeder
├── frontend/
│   └── src/
│       ├── api/                 # Axios client + service layer
│       ├── components/
│       │   ├── layout/          # AppLayout (sidebar + topbar)
│       │   └── ui/              # Badges, DataTable, Modal, Forms
│       ├── hooks/               # React Query hooks
│       ├── pages/               # All page components
│       └── store/               # Zustand auth store
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## API Reference

### Auth
| Method | Endpoint                   | Description              |
|--------|----------------------------|--------------------------|
| POST   | /api/v1/auth/login         | Login, returns JWT       |
| POST   | /api/v1/auth/register      | Register new user        |
| GET    | /api/v1/auth/me            | Current user profile     |
| POST   | /api/v1/auth/refresh       | Refresh access token     |
| POST   | /api/v1/auth/logout        | Revoke refresh token     |
| POST   | /api/v1/auth/change-password | Change password        |

### Records (Tickets)
| Method | Endpoint                         | Description           |
|--------|----------------------------------|-----------------------|
| GET    | /api/v1/records                  | List with filters     |
| POST   | /api/v1/records                  | Create ticket         |
| GET    | /api/v1/records/:id              | Get full detail       |
| PATCH  | /api/v1/records/:id              | Update ticket         |
| POST   | /api/v1/records/:id/comment      | Add comment           |
| POST   | /api/v1/records/:id/time-entry   | Log time              |
| GET    | /api/v1/records/:id/history      | Audit history         |

### Other Resources
- `/api/v1/users` — User CRUD (admin)
- `/api/v1/agents` — Agent management
- `/api/v1/customers` — Customer CRUD
- `/api/v1/contracts` — Contract management
- `/api/v1/cmdb` — Configuration Items
- `/api/v1/shifts` — Shift schedules
- `/api/v1/holidays` — Holiday calendars
- `/api/v1/dashboard` — KPI metrics
- `/api/v1/reports/time-entries` — Time reports
- `/api/v1/audit` — Audit log

---

## SLA Engine

The SLA engine runs **server-side only** as a BullMQ background worker:
- Checks every **60 seconds**
- Respects shift schedules, holidays, after-hours/weekend multipliers  
- Pauses SLA clock on `PENDING` status
- Sends **80% warning** email before breach
- Sends **breach alert** on deadline exceeded
- All results stored in `sla_tracking` table — never calculated on frontend

---

## Security Features

- **JWT** with short-lived access tokens (15min) + rotating refresh tokens (7d)
- **bcrypt** password hashing (12 rounds)
- **Tenant isolation** enforced at every query via `tenantId` filter
- **RBAC** middleware on all protected routes
- **Rate limiting** — 500/15min general, 10/15min on login
- **Zod validation** on all inputs
- **Helmet** security headers
- **Immutable audit log** for every state change

---

## Background Workers

| Worker      | Schedule        | Function                              |
|-------------|-----------------|---------------------------------------|
| SLA Checker | Every 60s       | Check deadlines, trigger warnings/breach |
| Email       | On-demand queue | Send templated notifications          |
| Escalation  | Every 5 min     | Auto-escalate unattended P1/P2        |
| Renewal     | Daily 08:00 UTC | Warn on contracts expiring in 30 days |
