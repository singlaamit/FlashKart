# FlashKart API Reference (for testers)

Base URL: `http://localhost:3000` (set `PORT` to change). All request and response bodies are JSON.
Success responses wrap the result as `{ "data": ... }`. Errors are `{ "message": "..." }`.

IDs are UUIDs. There is no login: the caller is identified by the `x-user-id` header.

## Setup

```bash
npm run seed     # creates demo users and products, prints their IDs
npm run dev      # starts the API on :3000
```

Seeded users: `alice@example.com`, `bob@example.com`, `carol@example.com`.
Seeded products include **Flash Sale Webcam** (stock 3, good for sold-out tests).
Copy the `id` values from the seed output and use them as `<USER_ID>` and `<PRODUCT_ID>` below.

**PowerShell note:** use `curl.exe` and escape inner quotes, e.g. `-d '{\"name\":\"Asha\"}'`.
Or import the requests into Postman / Thunder Client.

## Endpoint summary

| # | Method | Path | Headers | Purpose |
|---|---|---|---|---|
| 1 | GET | `/health` | none | Liveness check |
| 2 | POST | `/users` | none | Create a user |
| 3 | POST | `/products` | none | Create a product |
| 4 | GET | `/products` | none | List active products with `available` stock |
| 5 | GET | `/cart` | `x-user-id` | Get (or create) the user's active cart |
| 6 | POST | `/cart/items` | `x-user-id` | Add an item to the cart |
| 7 | POST | `/cart/reserve` | `x-user-id` | Hold stock for 5 minutes |
| 8 | POST | `/order/checkout` | `x-user-id`, `idempotency-key` | Turn a reservation into an order |
| 9 | POST | `/orders` | `x-user-id`, `idempotency-key` | Check out the whole cart |
| 10 | GET | `/orders` | `x-user-id` | List the user's orders |

`/order/...` and `/orders/...` are the same router, so `POST /orders/checkout` also works.

---

## 1. GET /health

```bash
curl http://localhost:3000/health
```
`200` → `{ "status": "ok" }`

## 2. POST /users

```json
{ "email": "asha@example.com", "name": "Asha" }
```
```bash
curl -X POST http://localhost:3000/users -H "Content-Type: application/json" \
  -d '{"email":"asha@example.com","name":"Asha"}'
```
| Status | Meaning |
|---|---|
| 201 | `{ "data": { "id", "email", "name", "createdAt", "updatedAt" } }` |
| 400 | `email` or `name` missing or not a string |
| 409 | Email already registered |

## 3. POST /products

```json
{ "name": "Phone", "price": 499.99, "stock": 10 }
```
- `name`: required, non-empty string.
- `price`: required number, 0 or more.
- `stock`: optional integer, 0 or more (default 0).

```bash
curl -X POST http://localhost:3000/products -H "Content-Type: application/json" \
  -d '{"name":"Phone","price":499.99,"stock":10}'
```
| Status | Meaning |
|---|---|
| 201 | `{ "data": { "id", "name", "price": "499.99", "stock": 10, "isActive": true, ... } }` |
| 400 | Validation failed |

## 4. GET /products

```bash
curl http://localhost:3000/products
```
`200` → `{ "data": [ { "id", "name", "price", "stock", "isActive", "saleEndsAt", "available", ... } ] }`

`available` = `stock` minus active, unexpired reservations (what can still be reserved).
Inactive products are not returned.

## 5. GET /cart

Header: `x-user-id: <USER_ID>`
```bash
curl http://localhost:3000/cart -H "x-user-id: <USER_ID>"
```
| Status | Meaning |
|---|---|
| 200 | `{ "data": { "id", "userId", "status": "active", "items": [ { "productId", "quantity", "product": {...} } ] } }` |
| 400 | `x-user-id` missing or not a UUID |

## 6. POST /cart/items

Header: `x-user-id`. Adds the item, or increases the quantity if it is already in the cart.
Stock is **not** checked here; it is enforced at checkout.
```json
{ "productId": "<PRODUCT_ID>", "quantity": 2 }
```
```bash
curl -X POST http://localhost:3000/cart/items -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" -d '{"productId":"<PRODUCT_ID>","quantity":2}'
```
| Status | Meaning |
|---|---|
| 201 | `{ "data": { "id", "cartId", "productId", "quantity" } }` |
| 400 | Bad header, `productId`, or `quantity` (must be an integer of 1 or more) |
| 404 | User not found, or product not found / inactive |

## 7. POST /cart/reserve  (flash-sale hold)

Header: `x-user-id`. Holds stock for **5 minutes**. Safe under concurrency: stock can never be oversold.
```json
{ "productId": "<PRODUCT_ID>", "quantity": 1 }
```
```bash
curl -X POST http://localhost:3000/cart/reserve -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" -d '{"productId":"<PRODUCT_ID>","quantity":1}'
```
Success `201`:
```json
{
  "message": "Stock reserved for 5 minutes",
  "data": {
    "reservationId": "…", "productId": "…", "userId": "…",
    "quantity": 1, "expiresAt": "2026-10-09T10:05:00.000Z", "status": "active"
  }
}
```
| Status | Meaning |
|---|---|
| 400 | Bad header, `productId`, or `quantity` (not an integer, or less than 1) |
| 404 | Product or user not found |
| 409 | `{ "message": "Insufficient stock", "available": N }` |
| 503 | Unexpected failure |

## 8. POST /order/checkout  (from a reservation)

Headers: `x-user-id`, `idempotency-key` (any unique string, e.g. a UUID).
```json
{ "reservationId": "<RESERVATION_ID>" }
```
```bash
curl -X POST http://localhost:3000/order/checkout -H "Content-Type: application/json" \
  -H "x-user-id: <USER_ID>" -H "idempotency-key: key-001" \
  -d '{"reservationId":"<RESERVATION_ID>"}'
```
Success returns an order:
```json
{ "message": "Order confirmed",
  "data": { "id", "userId", "idempotencyKey", "reservationId", "productId",
            "quantity", "totalAmount": "49.99", "status": "confirmed", "createdAt" } }
```
| Status | Meaning |
|---|---|
| 201 | Order confirmed (new order) |
| 200 | `Order already created`: same key and reservation sent again; returns the original order |
| 400 | Missing/invalid headers or `reservationId` |
| 404 | Reservation not found (or belongs to another user) |
| 409 | Reservation already used or released, or insufficient stock (reservation is released) |
| 410 | Reservation expired |
| 422 | Idempotency key was already used for a different request |
| 500 | Unexpected failure (reservation is released) |

## 9. POST /orders  (checkout the whole cart)

Headers: `x-user-id`, `idempotency-key`. No body. Uses the items in the user's active cart (see endpoint 6).
```bash
curl -X POST http://localhost:3000/orders -H "x-user-id: <USER_ID>" -H "idempotency-key: cart-key-001"
```
| Status | Meaning |
|---|---|
| 201 | `{ "data": order }`, status `confirmed` |
| 400 | Missing or invalid headers |
| 409 | Cart is empty, insufficient stock, or the idempotency key was already used by another user |
| 500 | Unexpected failure |

Re-sending the same key by the same user returns the original order (`201`), with no new order.

## 10. GET /orders

Header: `x-user-id`.
```bash
curl http://localhost:3000/orders -H "x-user-id: <USER_ID>"
```
`200` → `{ "data": [ order, ... ] }` (newest first). `400` if the header is invalid.

---

## Suggested test scenarios

| Scenario | Steps | Expected |
|---|---|---|
| Happy path | Reserve 1 → checkout with a new key | `201` reserve, `201` order, product `available` and `stock` drop by 1 |
| Duplicate checkout | Repeat the checkout with the **same** key | `200 Order already created`, same order `id`, no second order in `GET /orders` |
| Key misuse | Checkout a different reservation with an already-used key | `422` |
| Sold out | Reserve more than `available` (e.g. 4 of the 3-stock webcam) | `409` with `available` |
| Expiry | Reserve, wait over 5 minutes, checkout | `410`; stock is available again |
| Wrong user | Checkout a reservation using another user's `x-user-id` | `404` |
| Already used | Checkout the same reservation with a **new** key | `409` |
| Validation | Missing `x-user-id`, non-UUID IDs, `quantity: 0` or `1.5` | `400` |
| Concurrency | `npm run test:concurrency` (120 parallel reserves on stock 100, parallel duplicate checkouts) | All checks `PASS` |

## Frontend

`cd frontend && npm install && npm run dev`, then open `http://localhost:5173`.
Click **Create demo user**, pick a product, choose a quantity, and use **Add to Cart** and **Checkout**.
