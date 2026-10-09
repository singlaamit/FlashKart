import { AppDataSource } from "../data-source";

export const RESERVATION_TTL_MINUTES = 5;

// Available stock = product.stock minus active, unexpired reservations.
// The product row is locked (FOR UPDATE) so concurrent reservations for the
// same product are serialized and cannot oversell.
export async function reserveStock(
  productId: string,
  userId: string,
  quantity: number,
) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("INVALID_QUANTITY");
  }

  return AppDataSource.transaction(async (tx) => {
    const [user] = await tx.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    if (!user) throw new Error("USER_NOT_FOUND");

    const [product] = await tx.query(
      `SELECT stock FROM products
       WHERE id = $1 AND "isActive" = true FOR UPDATE`,
      [productId],
    );
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    const [{ reserved }] = await tx.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS reserved FROM reservations
       WHERE "productId" = $1 AND status = 'active' AND "expiresAt" > now()`,
      [productId],
    );

    const available = product.stock - reserved;
    if (available < quantity) {
      const error = new Error("INSUFFICIENT_STOCK");
      (error as Error & { available?: number }).available = Math.max(available, 0);
      throw error;
    }

    const [reservation] = await tx.query(
      `INSERT INTO reservations ("productId", "userId", quantity, "expiresAt")
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))
       RETURNING id AS "reservationId", "productId", "userId", quantity,
                 "expiresAt", status`,
      [productId, userId, quantity, RESERVATION_TTL_MINUTES],
    );
    return reservation;
  });
}
