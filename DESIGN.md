# FlashKart: Design Notes (Sections A, B, C, D)

> Redis is **not used**. Stock reservation, expiry, and checkout all run on
> PostgreSQL (row locks, a `reservations` table with `expiresAt`, unique
> indexes, transactions). Everything below describes what is actually built.

---

## A. Backend

### A1. Entities (`src/entities`)

| Entity | Key fields | Indexes / constraints |
|---|---|---|
| `User` | `id` (uuid), `email`, `name`, timestamps | unique `email` |
| `Product` | `id`, `name`, `price` (decimal 12,2), `stock`, `isActive`, `saleEndsAt` (nullable), timestamps | `CHECK (stock >= 0)` |
| `Cart` | `id`, `userId` → User, `status` (`active` / `checked_out` / `expired`), timestamps | index `userId` |
| `CartItem` | `id`, `cartId` → Cart (cascade), `productId` → Product, `quantity`, `reservationExpiresAt`, `createdAt` | indexes `cartId`, `productId`; `CHECK (quantity > 0)` |
| `Reservation` | `id`, `productId`, `userId`, `quantity`, `status` (`active` / `consumed` / `released`), `expiresAt`, `createdAt` | indexes `productId`, `userId`, `expiresAt`; `CHECK (quantity > 0)` |
| `Order` | `id`, `userId`, `idempotencyKey`, `reservationId`, `productId`, `quantity`, `totalAmount`, `status` (`pending` / `confirmed` / `cancelled`), `createdAt` | unique `idempotencyKey`, unique `reservationId`, index `userId`; `CHECK (totalAmount >= 0)` |

`Reservation` is an extra entity beyond the five requested. Without Redis it is
where the temporary stock hold lives.

**Assumptions**

- One product per reservation, and one reservation becomes one order (the flash
  sale buys a single deal). `Order` stores `productId` and `quantity` directly
  instead of an order-items table. A multi-item order would add an `OrderItem` entity.
- Money is a decimal string in the database and is computed in integer cents in
  code, so there is no floating-point drift.
- `stock` is the physical count and drops only at checkout. Available stock is
  `stock - SUM(active, unexpired reservations)`, so holds never need to be
  "returned" when they expire.
- Hold length is fixed at 5 minutes (`RESERVATION_TTL_MINUTES`).
- Users are identified by an `x-user-id` header. Real authentication (JWT or a
  session) would set this server-side, and it is out of scope here.
- Enum-like status fields are `varchar` for easy migrations. Hot-path queries
  use the indexes above.
- `synchronize` is on outside production for convenience. Production would use migrations.

### A2. `POST /cart/reserve` (no Redis)

Body: `{ productId, quantity }`, header `x-user-id`. Success is `201` with the
reservation and its server-decided `expiresAt`. Errors: `400` bad input,
`404` user or product not found, `409` insufficient stock (includes `available`),
`503` unexpected failure.

**How races are prevented.** The whole operation is one transaction:

1. `SELECT ... FROM products WHERE id = $1 FOR UPDATE` takes a row lock on the
   product. A second concurrent reserve for the same product waits here until
   the first commits.
2. It sums the live holds (`status = 'active' AND "expiresAt" > now()`), checks
   `stock - reserved >= quantity`, and inserts the reservation with
   `expiresAt = now() + 5 minutes` (database clock).
3. Commit releases the lock. The waiting request now sees the first one's hold
   in its sum.

So "check available" and "insert hold" can never interleave between two
requests, which is the same guarantee a Redis Lua script gives, but with the
data and the lock in one system. Different products use different row locks and
do not block each other.

### A3. `POST /order/checkout`

Headers: `x-user-id`, `idempotency-key`. Body: `{ reservationId }`.
Success is `201` (new order) or `200` (replay of the same request). Errors:
`404` reservation not found (also for another user's), `409` already used or
insufficient stock, `410` expired, `422` key reused for a different request.

Inside one TypeORM transaction it locks the reservation (`FOR UPDATE`), checks
it is active and not expired, locks the product and checks `stock >= quantity`,
decrements stock, marks the reservation `consumed`, and inserts the order. If
anything throws, everything rolls back, and the reservation is then marked
`released` so the stock is freed immediately instead of after 5 minutes.
Business errors that mean the reservation is not ours or is already resolved
(not found, already used, expired, key conflict) do not release it.

**How duplicate orders are prevented**: see D2. The layers are a replay lookup
by idempotency key, unique indexes on `idempotencyKey` and `reservationId`,
and the reservation row lock plus its `consumed` state.

Also available: `GET /products` (with computed `available`), `POST /users`,
`GET /cart`, `POST /cart/items`, `POST /orders` (cart checkout, same
idempotency rules) and `GET /orders`.

### Concurrency test

`npm run test:concurrency` (backend running, from `D:\test`) creates a product with
stock 100, fires 120 parallel reserves, checks out every success in parallel,
then replays one checkout with the same key 8 times in parallel. It expects 100
reserve successes and 20 `409`s, exactly 100 orders and final stock 0, and one
`201` plus seven `200`s on the replay. It exits non-zero if any check fails.

---

## B. React: Flash Sale Page

Key components (`frontend/src`):

| File | Role |
|---|---|
| `main.tsx` | App shell: demo-user sign-in (remembered in `localStorage`), product picker. |
| `components/FlashSalePage.tsx` | Container. Owns state, talks to the API. |
| `components/ProductCard.tsx` | Presentational: name, price, remaining stock, sale countdown, quantity, Add to Cart. |
| `components/ReservationTimer.tsx` | 5-minute hold countdown with progress bar, fires `onExpire` once. |
| `hooks/useCountdown.ts` | Ticking timer from a target time, with clock-skew correction. |
| `api.ts` | Typed fetch wrappers (`listProducts`, `createUser`, `reserve`, `checkout`). |
| `styles.css` | Responsive, light/dark styling. |

### State management

Plain React state, no Redux: the page shows one product at a time (the picker
remounts it with `key`, resetting its state) and holds at most one reservation.

- **Server state** (`product`, incl. `available`): fetched on mount and polled
  every 5 s, and refetched after every reserve, checkout or expiry. The server
  is the source of truth; the UI never computes stock itself.
- **Reservation state** (`held`): `{ reservation, expiresAt, idempotencyKey }`,
  set from the `/cart/reserve` response. Mirrored to `sessionStorage` so a page
  refresh keeps the same reservation, timer and idempotency key.
- **UI state** (`busy`, `notice`): disables buttons during requests and shows
  messages (sold out, expired, error).
- Timers are **derived, not stored**: `useCountdown` computes
  `expiresAt - now` each tick instead of counting down a number, so throttled
  background tabs and re-renders cannot drift.

### Reservation expiry handling

1. The expiry time (`expiresAt`) comes from the **server**, never computed on the client.
2. The client corrects for a wrong device clock using the HTTP `Date` header
   (`clockOffset = serverNow - clientNow`).
3. When the countdown reaches 0, `ReservationTimer` calls `onExpire` exactly
   once (guarded by a ref). The page clears `held`, disables Checkout, shows
   "reservation expired", and refetches stock (the units are available again).
4. The client timer is **only a UX hint**. The server enforces expiry: checkout
   returns `410` for an expired reservation, which triggers the same
   `handleExpire` path. A user who edits the clock or blocks the timer gains nothing.
5. After a refresh, `held` is restored only if `expiresAt` is still in the
   future; otherwise it is discarded.

---

## C1. High-Concurrency Design (10,000 req/s)

```
                 Clients
                    |
            CDN / static assets  (page, JS, images; no API load)
                    |
           Load balancer (L7, health checks, rate limit)
          /         |         \
     API node 1  API node 2  API node N     stateless, horizontally scaled
          \         |         /
              PgBouncer (connection pooling)
                    |
        +-----------+------------+
        |                        |
  PostgreSQL primary        Read replicas
  stock, reservations,      product listing,
  orders, idempotency keys  order history
```

- **Load balancing.** A load balancer spreads requests across identical,
  stateless API nodes (no session or stock in process memory), with health
  checks and per-user/IP rate limiting to absorb bots and retry storms. Adding
  nodes adds capacity roughly linearly.
- **Horizontal scaling.** API nodes autoscale on CPU or requests per second.
  Because correctness lives in the database (locks, constraints), any node can
  serve any request, and nodes never need to coordinate with each other.
- **Database optimization.**
  - The contended operation is "reserve stock". It runs in a short transaction
    that locks only the one product row (`SELECT ... FOR UPDATE`), so different
    products never block each other.
  - Indexes on `reservations("productId")`, `("expiresAt")`, `("userId")`;
    unique indexes on `orders."idempotencyKey"` and `orders."reservationId"`.
  - Short transactions, no network calls while holding a lock, PgBouncer so
    thousands of API connections share a small pool.
  - Reads (product list, stock display, order history) go to read replicas and
    a 1–2 s response cache, so the polling UI does not load the primary.
- **Handling 10k req/s of a flash sale.** Stock is finite (say 100 units), so
  only ~100 requests can ever succeed. Everyone else is rejected quickly with
  `409`. The cheap rejection path is: validate input, then one locked read of
  the product row and a sum over its few active reservations. For a single hot
  product, a row lock serializes those requests, so throughput is bounded by
  how fast one short transaction runs (low thousands per second on typical
  hardware). To stay well above 10k req/s on one product:
  - rate-limit and shed load at the load balancer, so most excess traffic never
    reaches Postgres;
  - serve the "sold out" state from a cache once available stock is 0;
  - optionally use a short admission queue ("waiting room") to cap concurrent
    reserve attempts.

**Trade-off.** Using only Postgres keeps one source of truth and no
cross-system consistency problems, at the cost of a per-product throughput
ceiling set by the row lock. An in-memory counter would raise that ceiling but
adds a second system that can drift from the database. For this scale, plus
load shedding, the simpler design is the better trade.

---

## C2. Data Consistency

### How overselling is prevented

1. **Reserve is serialized per product.** The reserve transaction locks the
   product row, computes `available = stock - SUM(active, unexpired
   reservations)`, and inserts the reservation only if `available >= qty`.
   Two requests cannot both see the last unit. Tested: 10 concurrent reserves
   against stock 5 gave exactly 5 successes and 5 `409`s.
2. **Checkout re-checks and decrements in one transaction.** It locks the
   reservation and the product, requires `stock >= qty`, then decrements
   `stock` and marks the reservation `consumed`.
3. **Database constraint.** `CHECK (stock >= 0)` on `products`. Even a code bug
   cannot persist negative stock; the write fails instead.

### Why reservations are stored with an expiry

A reservation is a *temporary* hold: it must stop counting after 5 minutes
without a cleanup job. Storing `expiresAt` and counting only rows with
`status = 'active' AND "expiresAt" > now()` makes expiry automatic and
race-free, and it uses the **database clock** so API nodes with skewed clocks
agree. Expired rows are inert and can be purged by a periodic delete.

### Eventual consistency

- The only eventually consistent piece is what the **UI shows**: the stock
  number is polled, so it can be a few seconds stale. It is a hint; the reserve
  call is the real, strongly consistent decision.
- Read replicas lag slightly, so replica-served stock can lag the primary.
  Reserve and checkout always use the primary, so they are never affected.
- When a hold expires, available stock rises again without any write. The UI
  picks that up on its next poll.

### Recovery

| Failure | Effect | Recovery |
|---|---|---|
| **Crash/timeout after reserve** | Stock is held for up to 5 min. | `expiresAt` passes; the hold stops counting automatically. |
| **Checkout fails mid-way** | Transaction rolls back (no partial order, no stock change). | The reservation is marked `released` so stock is freed immediately; the user can reserve again. |
| **Crash after commit, before response** | Client sees a timeout. | Client retries with the same idempotency key and receives the original order. |
| **API node dies** | In-flight requests fail. | Stateless: the load balancer routes to other nodes; client retries are idempotent. |
| **Database down** | Reserve and checkout fail (no selling without the source of truth). | Fail over to a replica/standby; holds that expire meanwhile simply release stock. Committed data is durable (WAL). |

---

## D1. Debugging: Overselling (stock = 100, orders = 120)

**Root cause:** a non-atomic check-then-act race. The code reads stock, checks
`stock >= qty`, and later writes `stock = stock - qty` as separate steps (or the
cached stock is read, then decremented elsewhere). With many concurrent
requests, many pass the check against the same stale value before any write
lands. Contributing causes: no `CHECK (stock >= 0)`, reservations not counted
against stock, and retries or double submits creating extra orders.

```ts
// BUG: read, check, then write. 120 requests can all read 100.
const p = await repo.findOneBy({ id });
if (p.stock >= qty) { p.stock -= qty; await repo.save(p); createOrder(); }
```

**Fix:**

1. Make the check and the decrement one atomic operation:
   `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`
   and treat 0 affected rows as "sold out" (or lock the row
   with `FOR UPDATE` inside a transaction).
2. Add `CHECK (stock >= 0)` so any remaining bug fails loudly.
3. Count live reservations against availability, and consume them at checkout.
4. Add idempotency keys so retries do not become extra orders.
5. Verify with a concurrency test (e.g. 120 parallel requests, expect exactly
   100 successes). The reservation endpoint here was tested this way
   (10 parallel on stock 5 gave 5 successes and 5 `409`s).

---

## D2. Debugging: Duplicate Checkout (refresh on payment page)

**Cause:** a refresh (or double-click, or a network retry) re-sends the
checkout request, and a naive server treats each as a new order.

**How this design prevents it:**

- **Client:** one idempotency key is generated per reservation and stored in
  `sessionStorage`, so a refresh re-sends the *same* key. The button is also
  disabled while the request is in flight.
- **Server, replay:** `POST /order/checkout` first looks the key up; if an
  order exists, it returns that order (`200`, "Order already created").
- **Server, race:** `orders.idempotencyKey` and `orders.reservationId` are
  **unique**. If two identical requests pass the lookup at the same moment, the
  database rejects the second insert, and the code catches the unique-violation
  and returns the first order.
- **Server, state:** the reservation row is locked (`FOR UPDATE`) and flipped
  to `consumed` in the same transaction as the order insert, so a request with
  a *different* key for the same reservation gets `409`.
- **Same key, different request** returns `422`, which surfaces client bugs.

Tested: 8 concurrent identical requests produced exactly 1 order (one `201`,
seven `200`); 8 concurrent requests with different keys on one reservation
produced exactly 1 order (one `201`, seven `409`).
