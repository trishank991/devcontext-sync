# DevContext Sync Backend

Cloud sync backend for DevContext Sync Pro users.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL (via Supabase)
- **ORM**: Drizzle ORM
- **Auth**: JWT tokens + License keys
- **Validation**: Zod

## Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL, anon key, and service role key
3. Get the database connection string from Settings > Database

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your Supabase credentials
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Setup Database

```bash
# Generate migrations from schema
npm run db:generate

# Push schema to database
npm run db:push

# (Optional) Open Drizzle Studio to view data
npm run db:studio
```

### 5. Run Development Server

```bash
npm run dev
```

## API Endpoints

### License

- `POST /api/v1/license/verify` - Verify license key and get JWT
- `POST /api/v1/license/generate` - Generate new license (admin only)
- `POST /api/v1/license/deactivate` - Deactivate a license

### Sync (requires auth)

- `POST /api/v1/sync/push` - Push local changes to server
- `GET /api/v1/sync/pull?since=<version>` - Pull changes since version

## Deployment

### Deploy to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

### Deploy to Render

1. Connect your GitHub repo
2. Set environment variables in Render dashboard
3. Deploy

### Deploy to Fly.io

```bash
fly launch
fly secrets set DATABASE_URL=... JWT_SECRET=...
fly deploy
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│ Chrome Extension│     │ VS Code Ext     │
│ (Browser)       │     │ (IDE)           │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │   Backend   │
              │  (Express)  │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │  Supabase   │
              │ (PostgreSQL)│
              └─────────────┘
```

## Security

- All sync endpoints require JWT authentication
- License keys are verified on first use
- Rate limiting prevents abuse
- CORS configured for extension origins only
- Helmet.js for security headers
