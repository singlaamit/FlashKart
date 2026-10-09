# FlashKart

High-concurrency flash-sale platform: users reserve limited stock for 5 minutes, then check out.
No overselling and no duplicate orders, built on PostgreSQL only (no Redis).

- **Backend:** Node.js, Express, TypeORM, PostgreSQL
- **Frontend:** React (Vite, TypeScript)

## Prerequisites

- Node.js 18 or newer
- PostgreSQL 13 or newer, with an empty database (e.g. `createdb flashkart`)

## Setup

### 1. Backend

```bash
git clone https://github.com/singlaamit/FlashKart.git
cd FlashKart
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env`:

```
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/flashkart
```

Tables are created automatically on startup (TypeORM `synchronize`, enabled whenever
`NODE_ENV` is not `production`). Production would use migrations.

### 2. Seed demo data

```bash
npm run seed
```

Creates 3 users and 6 products, and prints their IDs. It is safe to run again: existing
rows are kept, and the sale deadlines are reset to 60 minutes from now.

### 3. Start the API

```bash
npm run dev
```

Runs on `http://localhost:3000`. Check it with `GET /health` → `{"status":"ok"}`.

### 4. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, click **Create demo user**, pick a product, and use
**Add to Cart** and **Checkout**. The dev server proxies API calls to port 3000, so
the backend must be running.

## Scripts

| Where | Command | What it does |
|---|---|---|
| root | `npm run dev` | Compile and start the API (restarts on changes) |
| root | `npm run build` / `npm start` | Compile to `dist/` / run the compiled app |
| root | `npm run seed` | Insert demo users and products |
| root | `npm run test:concurrency` | Load test against a running API: 120 parallel reserves on stock 100, parallel duplicate checkouts. Exits non-zero on failure. It creates throwaway rows in the database. |
| `frontend/` | `npm run dev` | Start the Vite dev server |
| `frontend/` | `npm run build` | Type-check and build the frontend |

## Documentation

- [API.md](API.md): every endpoint with payloads, status codes and test scenarios
- [DESIGN.md](DESIGN.md): entities, how overselling and duplicate orders are prevented,
  scaling to 10,000 req/s, and the debugging write-ups

## Project layout

```
src/
  app.ts                 Express app and routes
  data-source.ts         TypeORM / PostgreSQL connection
  entities/              User, Product, Cart, CartItem, Reservation, Order
  routes/                HTTP handlers and validation
  services/              reservation.service.ts, checkout.service.ts (the transactions)
  seed.ts                demo data
  concurrency-test.ts    load test
frontend/src/
  main.tsx               sign-in and product picker
  components/            FlashSalePage, ProductCard, ReservationTimer
  hooks/useCountdown.ts  clock-skew-safe countdown
  api.ts                 typed API client
```

## Troubleshooting

- **`DATABASE_URL` undefined or connection refused:** check `.env` exists and PostgreSQL is running.
- **Frontend shows "Could not load products":** start the backend first (port 3000).
- **Port already in use:** change `PORT` in `.env`, and the proxy target in `frontend/vite.config.ts`.
- **No users or products:** run `npm run seed`.
