import { AppDataSource } from "../data-source";
import { Cart } from "../entities/Cart";
import { CartItem } from "../entities/CartItem";
import { Order } from "../entities/Order";

// Turns the user's active cart into an order. Safe to retry with the same key.
export async function checkout(userId: string, idempotencyKey: string) {
  const existing = await AppDataSource.getRepository(Order).findOneBy({
    idempotencyKey,
  });
  if (existing) {
    if (existing.userId !== userId) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
    return existing;
  }

  return AppDataSource.transaction(async (tx) => {
    const cart = await tx.findOne(Cart, {
      where: { userId, status: "active" },
    });
    if (!cart) throw new Error("CART_EMPTY");

    const items = await tx.find(CartItem, {
      where: { cartId: cart.id },
      relations: { product: true },
      order: { productId: "ASC" },
    });
    if (items.length === 0) throw new Error("CART_EMPTY");

    let totalCents = 0;
    for (const item of items) {
      // Lock the product, then leave other users' active reservations untouched.
      const [product] = await tx.query(
        `SELECT stock FROM products
         WHERE id = $1 AND "isActive" = true FOR UPDATE`,
        [item.productId],
      );
      const [{ reservedByOthers }] = await tx.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS "reservedByOthers"
         FROM reservations
         WHERE "productId" = $1 AND "userId" <> $2
           AND status = 'active' AND "expiresAt" > now()`,
        [item.productId, userId],
      );
      if (!product || product.stock - reservedByOthers < item.quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      await tx.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [
        item.quantity,
        item.productId,
      ]);
      // This user's own reservations are now fulfilled by the order.
      await tx.query(
        `UPDATE reservations SET status = 'consumed'
         WHERE "productId" = $1 AND "userId" = $2 AND status = 'active'`,
        [item.productId, userId],
      );
      totalCents += Math.round(Number(item.product.price) * 100) * item.quantity;
    }

    const order = await tx.save(
      tx.create(Order, {
        userId,
        idempotencyKey,
        totalAmount: (totalCents / 100).toFixed(2),
        status: "confirmed",
      }),
    );

    await tx.update(Cart, { id: cart.id }, { status: "checked_out" });
    return order;
  });
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; driverError?: { code?: string } };
  return (e?.driverError?.code ?? e?.code) === "23505";
}

// Business failures where the reservation is not ours to touch (or is already
// resolved), so it must not be released.
const KEEP_RESERVATION = new Set([
  "RESERVATION_NOT_FOUND",
  "RESERVATION_ALREADY_USED",
  "RESERVATION_EXPIRED",
  "IDEMPOTENCY_KEY_CONFLICT",
]);

async function findReplay(
  idempotencyKey: string,
  userId: string,
  reservationId: string,
) {
  const existing = await AppDataSource.getRepository(Order).findOneBy({
    idempotencyKey,
  });
  if (!existing) return null;
  // Same key must mean the same request, otherwise it is a client bug.
  if (existing.userId !== userId || existing.reservationId !== reservationId) {
    throw new Error("IDEMPOTENCY_KEY_CONFLICT");
  }
  return existing;
}

// Converts an active reservation into a confirmed order in one transaction.
// Returns { order, replayed }. Duplicates are prevented by three layers:
//  1. replay lookup by idempotency key (returns the original order),
//  2. unique indexes on orders.idempotencyKey and orders.reservationId,
//  3. a row lock on the reservation plus its status flipping to "consumed".
export async function checkoutReservation(
  userId: string,
  reservationId: string,
  idempotencyKey: string,
) {
  const replay = await findReplay(idempotencyKey, userId, reservationId);
  if (replay) return { order: replay, replayed: true };

  try {
    const order = await AppDataSource.transaction(async (tx) => {
      // Lock so two concurrent checkouts of one reservation run one at a time.
      const [reservation] = await tx.query(
        `SELECT id, "userId", "productId", quantity, status,
                "expiresAt" > now() AS "isLive"
         FROM reservations WHERE id = $1 FOR UPDATE`,
        [reservationId],
      );
      // Another user's reservation is reported as not found.
      if (!reservation || reservation.userId !== userId) {
        throw new Error("RESERVATION_NOT_FOUND");
      }
      if (reservation.status !== "active") {
        throw new Error("RESERVATION_ALREADY_USED");
      }
      if (!reservation.isLive) throw new Error("RESERVATION_EXPIRED");

      const [product] = await tx.query(
        `SELECT price, stock FROM products
         WHERE id = $1 AND "isActive" = true FOR UPDATE`,
        [reservation.productId],
      );
      if (!product || product.stock < reservation.quantity) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      await tx.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [
        reservation.quantity,
        reservation.productId,
      ]);
      await tx.query(
        `UPDATE reservations SET status = 'consumed' WHERE id = $1`,
        [reservationId],
      );

      const totalCents = Math.round(Number(product.price) * 100) * reservation.quantity;
      return tx.save(
        tx.create(Order, {
          userId,
          idempotencyKey,
          reservationId,
          productId: reservation.productId,
          quantity: reservation.quantity,
          totalAmount: (totalCents / 100).toFixed(2),
          status: "confirmed",
        }),
      );
    });
    return { order, replayed: false };
  } catch (error) {
    // Lost a race with an identical request: return the winner's order. Either
    // the unique index rejected our insert, or the reservation lock made us wait
    // until the winner committed and we then saw it already consumed.
    const failure = error instanceof Error ? error.message : "";
    if (isUniqueViolation(error) || failure === "RESERVATION_ALREADY_USED") {
      const winner = await findReplay(idempotencyKey, userId, reservationId);
      if (winner) return { order: winner, replayed: true };
    }

    // The transaction rolled back. Release the hold so the stock is freed
    // instead of sitting reserved until it expires.
    const code = error instanceof Error ? error.message : "";
    if (!KEEP_RESERVATION.has(code)) {
      await AppDataSource.query(
        `UPDATE reservations SET status = 'released'
         WHERE id = $1 AND "userId" = $2 AND status = 'active'`,
        [reservationId, userId],
      ).catch((releaseError) =>
        console.error("Failed to release reservation", releaseError),
      );
    }
    throw error;
  }
}
