import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Cart } from "../entities/Cart";
import { CartItem } from "../entities/CartItem";
import { Product } from "../entities/Product";
import { User } from "../entities/User";
import { reserveStock } from "../services/reservation.service";
import { isUuid } from "./validation";

const router = Router();

async function getActiveCart(userId: string) {
  const carts = AppDataSource.getRepository(Cart);
  return (
    (await carts.findOneBy({ userId, status: "active" })) ??
    carts.save(carts.create({ userId }))
  );
}

router.get("/", async (req, res) => {
  const userId = req.header("x-user-id");
  if (!isUuid(userId)) {
    return res.status(400).json({ message: "x-user-id (uuid) is required" });
  }
  const cart = await getActiveCart(userId);
  const items = await AppDataSource.getRepository(CartItem).find({
    where: { cartId: cart.id },
    relations: { product: true },
  });
  return res.json({ data: { ...cart, items } });
});

// Adds (or increases) a cart line. Stock is only enforced at checkout.
router.post("/items", async (req, res) => {
  const userId = req.header("x-user-id");
  const { productId, quantity } = req.body ?? {};

  if (
    !isUuid(userId) ||
    !isUuid(productId) ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    return res.status(400).json({
      message: "x-user-id, productId (uuids) and positive integer quantity required",
    });
  }

  const [user, product] = await Promise.all([
    AppDataSource.getRepository(User).existsBy({ id: userId }),
    AppDataSource.getRepository(Product).findOneBy({
      id: productId,
      isActive: true,
    }),
  ]);
  if (!user) return res.status(404).json({ message: "User not found" });
  if (!product) return res.status(404).json({ message: "Product not found" });

  const cart = await getActiveCart(userId);
  const items = AppDataSource.getRepository(CartItem);
  const line = await items.findOneBy({ cartId: cart.id, productId });
  const saved = await items.save(
    line
      ? { ...line, quantity: line.quantity + quantity }
      : items.create({ cartId: cart.id, productId, quantity }),
  );
  return res.status(201).json({ data: saved });
});

router.post("/reserve", async (req, res) => {
  try {
    // Assume authentication middleware has set req.user.
    const userId = req.header("x-user-id");
    const { productId, quantity } = req.body ?? {};

    if (!isUuid(userId) || !isUuid(productId) || !Number.isSafeInteger(quantity)) {
      return res.status(400).json({
        message:
          "x-user-id and productId (uuids) and integer quantity are required",
      });
    }

    const reservation = await reserveStock(productId, userId, quantity);

    return res.status(201).json({
      message: "Stock reserved for 5 minutes",
      data: reservation,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";

    if (code === "INVALID_QUANTITY") {
      return res.status(400).json({ message: "Quantity must be positive" });
    }

    if (code === "INSUFFICIENT_STOCK") {
      const { available } = error as Error & { available?: number };
      return res
        .status(409)
        .json({ message: "Insufficient stock", available });
    }

    if (code === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }

    if (code === "USER_NOT_FOUND") {
      return res.status(404).json({ message: "User not found" });
    }

    console.error("Reservation failed", error);
    return res.status(503).json({ message: "Reservation failed" });
  }
});

export default router;
