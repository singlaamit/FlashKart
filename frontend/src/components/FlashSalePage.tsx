import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkout, listProducts, reserve } from "../api";
import type { Order, Product, Reservation } from "../api";
import { ProductCard } from "./ProductCard";
import { ReservationTimer } from "./ReservationTimer";

interface Held {
  reservation: Reservation;
  expiresAt: number; // epoch ms
  idempotencyKey: string; // fixed per reservation, see handleAddToCart
}

type Notice = { kind: "info" | "error" | "success"; text: string } | null;

const POLL_MS = 5000;

export function FlashSalePage({ userId, productId }: { userId: string; productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);

  // Survives a refresh, so the reservation, its timer and its idempotency key
  // are the same after reload (the timer is recomputed from the server's expiresAt).
  const storageKey = `flashsale:${userId}:${productId}`;
  const [held, setHeld] = useState<Held | null>(() => {
    try {
      const saved: Held | null = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      return saved && saved.expiresAt > Date.now() ? saved : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (held) sessionStorage.setItem(storageKey, JSON.stringify(held));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable: page still works, just not across refresh */
    }
  }, [held, storageKey]);

  const [clockOffset, setClockOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);

  // Server state: refresh stock now and every few seconds. Server is the source of truth.
  const refresh = useCallback(async () => {
    try {
      const { data, serverNow } = await listProducts();
      setProduct(data.find((p) => p.id === productId) ?? null);
      setClockOffset(serverNow - Date.now());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleAddToCart() {
    setBusy(true);
    setNotice(null);
    setLastOrder(null);
    try {
      const { data } = await reserve(userId, productId, quantity);
      setHeld({
        reservation: data,
        expiresAt: Date.parse(data.expiresAt),
        // One key per reservation: refresh/double-click/retry reuse it, so the
        // server returns the same order instead of creating another.
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      // 409 = someone else got the units first.
      const text =
        e instanceof ApiError
          ? e.status === 409 && e.available !== undefined
            ? `Only ${e.available} left, someone got there first.`
            : e.message
          : "Network error, try again";
      setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  // Called by the timer, or when the server answers 410 at checkout.
  const handleExpire = useCallback(() => {
    setHeld(null);
    setNotice({ kind: "info", text: "Your reservation expired. Add to cart again to retry." });
    void refresh(); // the released units show up again
  }, [refresh]);

  // Latest `held` for the async handler without re-creating it on every tick.
  const heldRef = useRef(held);
  heldRef.current = held;

  async function handleCheckout() {
    const current = heldRef.current;
    if (!current || busy) return;
    setBusy(true);
    try {
      const { data } = await checkout(userId, current.reservation.reservationId, current.idempotencyKey);
      setHeld(null);
      setLastOrder(data);
      setNotice({ kind: "success", text: "Order confirmed!" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) return handleExpire();
      setNotice({ kind: "error", text: e instanceof ApiError ? e.message : "Network error, try again" });
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  if (!loaded) return <p className="muted">Loading…</p>;
  if (!product) {
    return loadFailed ? (
      <div className="notice error">
        Could not reach the server. <button onClick={() => void refresh()}>Retry</button>
      </div>
    ) : (
      <p className="notice error">Product not found.</p>
    );
  }

  const heldTotal = held ? (Number(product.price) * held.reservation.quantity).toFixed(2) : null;

  return (
    <main className="flash-sale">
      <ProductCard
        product={product}
        clockOffset={clockOffset}
        quantity={quantity}
        busy={busy}
        hasReservation={held !== null}
        onQuantityChange={setQuantity}
        onAddToCart={handleAddToCart}
      />

      {held && (
        <section className="cart">
          <h3>Your cart</h3>
          <p>
            {held.reservation.quantity} × {product.name} — <strong>₹{heldTotal}</strong>
          </p>
          <ReservationTimer expiresAt={held.expiresAt} clockOffset={clockOffset} onExpire={handleExpire} />
          <button className="primary" onClick={handleCheckout} disabled={busy}>
            {busy ? "Placing order…" : "Checkout"}
          </button>
        </section>
      )}

      {notice && (
        <p role="status" className={`notice ${notice.kind}`}>
          {notice.text}
          {lastOrder && <> Total ₹{lastOrder.totalAmount} · Ref {lastOrder.id.slice(0, 8)}</>}
        </p>
      )}

      {loadFailed && <p className="muted">Connection problem, retrying…</p>}
    </main>
  );
}
