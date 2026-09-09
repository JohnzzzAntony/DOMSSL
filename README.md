# CertGuard — Domain & SSL Manager

A production-ready, secure web application for centralized management of **domains, SSL/TLS
certificates, servers, DNS providers, expiry monitoring, notifications, certificate issuance,
automatic renewal, and automatic certificate installation**.

Built to the "Domain & SSL Manager" build specification: enterprise DevOps/SaaS control panel —
not a generic hosting panel.

---

## Core Product Principles

- **Never blindly trust manually entered expiry dates.** Every domain is verified against
  authoritative sources (RDAP registry first, registrar APIs as optional adapters).
- **Live SSL inspection.** The application connects to the actual HTTPS endpoint and inspects
  the real certificate — never relying on stored data.
- **Compare stored vs discovered dates** and clearly surface mismatches (`VERIFIED` /
  `DATE MISMATCH` states everywhere).
- **Never silently overwrite** a stored value without an audit entry and explicit approval.
- **5-day mandatory critical alert** threshold for both SSL and domain expiry.
- **Safe deployment pipeline:** backup → upload → permissions → config test → reload →
  live verification → **rollback** when verification fails. Reload never happens if the
  configuration test fails.
- **Predefined operations only** — arbitrary shell execution from user input is impossible.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, shadcn/ui, Recharts, TanStack Query, React Hook Form + Zod, Framer Motion |
| Backend | Next.js API routes, TypeScript service layer, Prisma ORM |
| Database | SQLite (default) / PostgreSQL (optional profile for multi-instance) |
| Background jobs | DB-backed job engine + in-process scheduler (BullMQ/Redis-compatible architecture) |
| Security | scrypt password hashing, httpOnly session cookies, AES-256-GCM credential encryption, RBAC, Zod validation, SSRF guards, audit logging |

## Feature Map

- **Dashboard** — metric cards, secondary status cards, fleet donut chart, domain overview,
  recent automation activity.
- **Domains** — CRUD, verification pipeline (RDAP → SSL → DNS → compare), bulk scanner,
  per-domain verification history, date-mismatch resolution with audit trail.
- **Certificates** — live-inspected inventory, full X.509 details, SAN list, chain checks,
  ACME request (HTTP-01 / DNS-01), renewal, installation, rollback, history.
- **Servers** — SSH server registry with encrypted credentials, connection testing,
  predefined operations (check/reload Nginx & Apache, verify SSL), encrypted backups.
- **DNS Providers** — Cloudflare integration with real API testing, encrypted token storage.
- **Notifications** — Email / WhatsApp / Telegram / Slack channels, per-domain routing,
  configurable thresholds (30/15/7/5 SSL · 60/30/15/7/5 domain · mandatory 5-day alert),
  test delivery, delivery tracking.
- **Automation Logs** — every job with step-by-step progress and timestamped terminal logs.
- **Reports** — six operational reports with CSV export.
- **Settings** — general, integrations, security (2FA policy, IP allowlist, session timeout),
  RBAC user management, live system health indicators, audit trail.
- **RBAC** — `OWNER > ADMIN > OPERATOR > VIEWER` with granular permissions
  (`domains.*`, `certificates.*`, `servers.*`, `dns.*`, `notifications.manage`,
  `users.manage`, `settings.manage`).

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env   # edit ENCRYPTION_KEY at minimum

# 3. Create the database
bun run db:push

# 4. Start the development server
bun run dev
# → http://localhost:3000
```

Demo data (clearly marked with a **DEMO** badge, spec §63) is seeded automatically on first
login page load. **Delete it via the UI before managing real infrastructure.**

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Owner | `admin@example.com` | `Admin123!` |
| Operator | `operator@example.com` | `Operator123!` |
| Viewer | `viewer@example.com` | `Viewer123!` |

## Production Deployment (Docker)

```bash
cp .env.example .env    # set a strong ENCRYPTION_KEY
docker compose up -d    # builds web, persists SQLite volume
```

Optional profiles:

```bash
docker compose --profile postgres up -d   # + PostgreSQL (switch Prisma provider first)
docker compose --profile redis up -d      # + Redis (for BullMQ worker scaling)
docker compose --profile nginx up -d      # + reverse proxy with TLS
```

### Production checklist (spec §60, §67)

1. Set a strong `ENCRYPTION_KEY` (32+ chars) — credentials are encrypted with AES-256-GCM.
2. Serve over HTTPS only (HSTS + secure cookies activate with `NODE_ENV=production`).
3. Set `ACME_LIVE=true` and provide ACME account credentials to enable live issuance
   (the shipped provider runs in clearly-labelled simulation mode).
4. Set `SSH_LIVE=true` and plug in the `ssh2` transport in
   `src/lib/engines/providers/ssh-deployment.ts` for real server operations.
5. Configure SMTP / Telegram / Slack for live alert delivery.
6. Restrict network egress from the container to required endpoints (RDAP, ACME, DNS APIs).
7. Review the Security notes below before exposing to the internet.

## Security Notes (spec §32, §33, §59)

- Passwords hashed with **scrypt** (memory-hard KDF) — never stored in plaintext.
- Sessions are opaque 256-bit tokens, SHA-256 hashed in the database, delivered as
  `httpOnly`, `SameSite=Lax`, `Secure` (in production) cookies.
- SSH keys, SSH passwords and API tokens are **encrypted at rest** (AES-256-GCM with a
  server-side key) and **never returned to the frontend**.
- **SSRF protection**: all user-supplied targets are validated against localhost, private
  IPv4 ranges, link-local and metadata endpoints before any connection is made.
- **Command allowlisting**: server operations are a fixed enum; arbitrary shell execution
  from user input is impossible.
- **Reload safety**: Nginx/Apache are only reloaded after a passing configuration test;
  failures trigger automatic rollback to the last encrypted backup.
- Zod validation on every write endpoint; Prisma parameterisation against SQL injection.
- Every sensitive action writes an immutable **audit log** entry.

## Simulation vs Live Modes

The architecture uses swappable provider interfaces (spec §25–§31):

| Capability | Interface | This build | Production |
|---|---|---|---|
| Domain verification | `DomainVerificationService` | Real RDAP via rdap.org, fallback clearly marked `SIMULATION` | RDAP + registrar API adapters |
| SSL inspection | `CertificateInspector` | **Real live TLS inspection** (node `tls`), fallback `SIMULATION` | Same — always live |
| Certificate issuance | `CertificateProvider` | ACME state machine in verifiable simulation (`ACME_LIVE=false`) | `acme-client` adapter |
| DNS | `DNSProvider` | **Real Cloudflare API** (token test, records) | Same |
| Server deployment | `ServerDeploymentProvider` | Full backup→test→reload→rollback state machine over simulated transport | `ssh2` adapter |

Every simulated result is labelled with `source: SIMULATION` in the UI and API — stored
dates are never silently presented as authoritative (spec §49).

## Project Structure

```
src/
├── app/
│   ├── page.tsx              # SPA entry (hash routing, auth gate)
│   └── api/                  # REST API (auth, domains, certificates, servers,
│                             #   dns, notifications, logs, audit, reports,
│                             #   settings, health)
├── components/
│   ├── app/                  # shell, login, routing
│   ├── pages/                # one module per screen
│   ├── shared/               # status system, widgets, skeletons
│   └── ui/                   # shadcn/ui primitives
├── lib/
│   ├── auth.ts               # sessions, scrypt, RBAC
│   ├── crypto.ts             # AES-256-GCM encryption service
│   ├── status.ts             # expiry thresholds & status roll-up
│   ├── validators.ts         # Zod schemas + SSRF guard
│   ├── engines/              # rdap, ssl-inspector, notifications
│   │   └── providers/        # acme, cloudflare, ssh-deployment
│   ├── jobs/                 # engine (queues/steps/logs), scheduler
│   └── seed.ts               # idempotent demo seed
prisma/schema.prisma          # 17 models
Dockerfile · docker-compose.yml · .env.example
```

## API Overview (spec §39)

All endpoints authenticate, authorize, validate, operate, audit and sanitize:

```
POST /api/auth/login | logout          GET /api/auth/me
GET  /api/dashboard
GET/POST /api/domains                  GET/PATCH/DELETE /api/domains/:id
POST /api/domains/:id/verify           POST /api/domains/bulk-scan
GET  /api/certificates                 GET /api/certificates/:id
POST /api/certificates/request         POST /api/certificates/:id/renew
POST /api/certificates/:id/install     POST /api/certificates/:id/rollback
GET/POST /api/servers                  GET/PATCH/DELETE /api/servers/:id
POST /api/servers/:id/test             POST /api/servers/:id/operations
GET/POST /api/dns/providers            DELETE /api/dns/providers/:id
POST /api/dns/providers/:id/test
GET/PATCH/POST /api/notifications      GET/PATCH /api/notifications/settings
GET/PATCH /api/notifications/channels
GET /api/logs                          GET /api/logs/:id
GET /api/audit                         GET /api/reports (?report=…&format=csv)
GET/PATCH /api/settings                GET /api/health
```

Structured errors follow spec §41: `{ "success": false, "code": "NGINX_CONFIG_INVALID", "message": "…" }`.
