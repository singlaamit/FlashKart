// Run against a live backend: npm run test:concurrency
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const STOCK = 100;
const REQUESTS = 120;
const USERS = 20;

let failed = false;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual}, expected ${expected}`);
}

async function call(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: any };
  return { status: res.status, data: json.data };
}

const tally = (statuses: number[]) =>
  statuses.reduce<Record<number, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});

async function main() {
  const run = Date.now();
  const users: string[] = [];
  for (let i = 0; i < USERS; i++) {
    const r = await call("/users", "POST", {}, { name: `Load ${i}`, email: `load-${run}-${i}@x.com` });
    users.push(r.data.id);
  }
  const product = (
    await call("/products", "POST", {}, { name: `Concurrency ${run}`, price: 10, stock: STOCK })
  ).data;

  // 1. 120 parallel reserves against stock 100.
  const reserves = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      call("/cart/reserve", "POST", { "x-user-id": users[i % USERS] }, { productId: product.id, quantity: 1 }),
    ),
  );
  const counts = tally(reserves.map((r) => r.status));
  console.log("reserve statuses", counts);
  check("reserve successes", counts[201] ?? 0, STOCK);
  check("reserve rejections (409)", counts[409] ?? 0, REQUESTS - STOCK);

  // 2. Check out every reservation in parallel, each with its own key.
  const won = reserves.filter((r) => r.status === 201);
  const checkouts = await Promise.all(
    won.map((r, i) =>
      call(
        "/order/checkout",
        "POST",
        { "x-user-id": r.data.userId, "idempotency-key": `k-${run}-${i}` },
        { reservationId: r.data.reservationId },
      ),
    ),
  );
  check("orders created (201)", checkouts.filter((c) => c.status === 201).length, STOCK);

  const list = (await call("/products", "GET", {})).data as { id: string; stock: number; available: number }[];
  const after = list.find((p) => p.id === product.id);
  check("final stock", after?.stock, 0);
  check("final available", after?.available, 0);

  // 3. Same checkout replayed in parallel must yield one order.
  const one = (
    await call("/products", "POST", {}, { name: `Replay ${run}`, price: 5, stock: 1 })
  ).data;
  const held = (await call("/cart/reserve", "POST", { "x-user-id": users[0] }, { productId: one.id, quantity: 1 })).data;
  const replays = await Promise.all(
    Array.from({ length: 8 }, () =>
      call(
        "/order/checkout",
        "POST",
        { "x-user-id": users[0], "idempotency-key": `replay-${run}` },
        { reservationId: held.reservationId },
      ),
    ),
  );
  const rc = tally(replays.map((r) => r.status));
  console.log("replay statuses", rc);
  check("replay: new orders (201)", rc[201] ?? 0, 1);
  check("replay: replays (200)", rc[200] ?? 0, 7);
  check("replay: distinct order ids", new Set(replays.map((r) => r.data?.id)).size, 1);

  console.log(failed ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("Test could not run (is the backend up?)", e);
  process.exit(1);
});
