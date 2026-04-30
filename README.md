# YT CRM — YouTube Upload Manager

Web CRM untuk mengelola dan upload video YouTube. Dirancang dengan arsitektur **dual-VPS**:
**Web app jalan di VPS Indonesia (RAM besar)**, sedangkan **upload worker jalan di VPS US** sehingga YouTube melihat upload dari IP Amerika.

## Stack

- **Frontend** — Vite + React 18 + TypeScript + Tailwind + shadcn/ui + TanStack Query
- **Backend (API)** — Bun + ElysiaJS + Drizzle ORM + PostgreSQL
- **Worker (US)** — Bun + ElysiaJS + googleapis
- **Deployment** — Docker Compose

## Arsitektur

```
                  ┌─ VPS Indonesia ──────────────────┐         ┌─ VPS US ──────────────┐
[User] ──HTTPS──> │  Web (Vite)   <──>  API (Elysia) │ ──HTTP─>│  Worker (Elysia)      │ ──> YouTube
                  │                       │           │         │  (mini upload relay)  │
                  │                       └── Postgres│         └───────────────────────┘
                  └──────────────────────────────────┘
```

## Struktur Folder

```
crm_youtube/
├── apps/
│   ├── web/      # React frontend (port 5173)
│   ├── api/      # Backend Indonesia (port 3000)
│   └── worker/   # Worker US (port 3001)
├── docker-compose.yml       # Local dev (semua di Mac)
├── docker-compose.indo.yml  # Production VPS Indo (web + api + db)
├── docker-compose.us.yml    # Production VPS US (worker only)
└── .env                     # Environment variables
```

## Local Development

### Setup pertama kali

```bash
# 1. Pastikan Docker Desktop running
# 2. Setup environment
cp .env.example .env  # lalu isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dll

# 3. Start semua service
docker compose up --build

# 4. Run migrations (sekali, di terminal lain)
docker compose exec api bun run db:migrate
```

### Akses
- Web:    http://localhost:5173
- API:    http://localhost:3000
- Worker: http://localhost:3001
- Postgres: localhost:5432

### Workflow

```bash
docker compose up           # start
docker compose down         # stop
docker compose logs -f api  # tail logs satu service
docker compose exec api sh  # shell ke container
```

### Tanpa Docker (Bun langsung)

```bash
# Install
cd apps/web    && bun install
cd apps/api    && bun install
cd apps/worker && bun install

# Postgres tetap pakai Docker
docker compose up -d postgres

# Run di 3 terminal terpisah
cd apps/api    && bun run dev
cd apps/worker && bun run dev
cd apps/web    && bun run dev
```

## Deploy Production

### VPS Indonesia (Web + API + Database)

```bash
# Di VPS Indonesia
git clone <repo> /root/ytcrm
cd /root/ytcrm
cp .env.example .env
nano .env  # set production values, terutama:
           # GOOGLE_REDIRECT_URI=https://your-domain.com/auth/callback
           # WORKER_URL=http://VPS_US_IP:3001
           # WORKER_API_KEY=<random-secret>

docker compose -f docker-compose.indo.yml up -d --build
docker compose -f docker-compose.indo.yml exec api bun run db:migrate
```

Setup nginx + SSL untuk domain (sama seperti deploy biasa).

### VPS US (Worker)

```bash
# Di VPS US (Digital Ocean 167.71.190.61)
git clone <repo> /root/ytcrm
cd /root/ytcrm
cp .env.example .env
nano .env  # set:
           # WORKER_API_KEY=<sama-dengan-yang-di-VPS-Indo>
           # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

docker compose -f docker-compose.us.yml up -d --build
```

Buka firewall port 3001 (atau pakai nginx + SSL untuk security):
```bash
ufw allow 3001/tcp
```

### Update Google OAuth Redirect URI

Di [console.cloud.google.com](https://console.cloud.google.com):
- **Authorized JavaScript origins:** `https://your-indo-domain.com`
- **Authorized redirect URIs:** `https://your-indo-domain.com/auth/callback`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth Client ID dari Google Console |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Redirect URI (harus match dengan Google Console) |
| `JWT_SECRET` | Secret untuk JWT (`openssl rand -base64 32`) |
| `DATABASE_URL` | Postgres connection string |
| `WORKER_URL` | URL worker VPS US (e.g. `http://1.2.3.4:3001`) |
| `WORKER_API_KEY` | Shared secret antara API & Worker |

## Database Migrations

```bash
# Generate migration setelah ubah schema
docker compose exec api bun run db:generate

# Apply migrations
docker compose exec api bun run db:migrate

# Drizzle Studio (UI buat lihat data)
docker compose exec api bun run db:studio
```
