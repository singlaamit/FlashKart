import type { Product } from "../api";
import { formatMs, useCountdown } from "../hooks/useCountdown";

export const MAX_PER_ORDER = 5;

interface Props {
  product: Product;
  clockOffset: number;
  quantity: number;
  busy: boolean; // a reserve request is in flight
  hasReservation: boolean;
  onQuantityChange: (quantity: number) => void;
  onAddToCart: () => void;
}

// Presentational: stock, sale countdown, quantity and the Add to Cart button.
export function ProductCard({
  product,
  clockOffset,
  quantity,
  busy,
  hasReservation,
  onQuantityChange,
  onAddToCart,
}: Props) {
  const saleEnd = product.saleEndsAt ? Date.parse(product.saleEndsAt) : null;
  const saleMs = useCountdown(saleEnd, clockOffset);
  const saleOver = saleEnd !== null && saleMs === 0;
  const soldOut = product.available <= 0;
  const maxQty = Math.max(1, Math.min(MAX_PER_ORDER, product.available));

  const disabled = busy || soldOut || saleOver || hasReservation;
  const label = soldOut
    ? "Sold out"
    : saleOver
      ? "Sale ended"
      : hasReservation
        ? "In your cart"
        : busy
          ? "Reserving…"
          : "Add to Cart";

  return (
    <article className="product-card">
      <header>
        <h2>{product.name}</h2>
        {saleEnd !== null && (
          <span className={`badge ${saleOver ? "badge-off" : saleMs < 300_000 ? "badge-urgent" : ""}`}>
            {saleOver ? "Sale ended" : `Ends in ${formatMs(saleMs)}`}
          </span>
        )}
      </header>

      <p className="price">₹{product.price}</p>

      <p className={`stock ${product.available <= 5 ? "low-stock" : ""}`}>
        {soldOut ? "No stock left" : product.available <= 5 ? `Only ${product.available} left!` : `${product.available} in stock`}
      </p>

      <div className="actions">
        <label className="qty">
          Qty
          <select
            value={Math.min(quantity, maxQty)}
            onChange={(e) => onQuantityChange(Number(e.target.value))}
            disabled={disabled}
          >
            {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={onAddToCart} disabled={disabled}>
          {label}
        </button>
      </div>
    </article>
  );
}
