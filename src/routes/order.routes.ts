import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Order } from "../entities/Order";
import { checkout, checkoutReservation } from "../services/checkout.service";
import { isUuid } from "./validation";

const router = Router();

// POST /order/checkout: confirm an order from a reservation.
router.post("/checkout", async (req, res) => {
  const userId = req.header("x-user-id");
  const idempotencyKey = req.header("idempotency-key");
  const { reservationId } = req.body ?? {};

  if (!isUuid(userId) || !isUuid(reservationId) || !idempotencyKey) {
    return res.status(400).json({
      message:
        "x-user-id (uuid), idempotency-key header and reservationId (uuid) are required",
    });
  }

  try {
    const { order, replayed } = await checkoutReservation(
      userId,
      reservationId,
      idempotencyKey,
    );
    return res
      .status(replayed ? 200 : 201)
      .json({ message: replayed ? "Order already created" : "Order confirmed", data: order });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known: Record<string, [number, string]> = {
      RESERVATION_NOT_FOUND: [404, "Reservation not found"],
      RESERVATION_ALREADY_USED: [409, "Reservation already used or released"],
      RESERVATION_EXPIRED: [410, "Reservation expired"],
      INSUFFICIENT_STOCK: [409, "Insufficient stock; reservation released"],
      IDEMPOTENCY_KEY_CONFLICT: [422, "Idempotency key already used for a different request"],
    };
    if (known[code]) {
      return res.status(known[code][0]).json({ message: known[code][1] });
    }
    console.error("Reservation checkout failed", error);
    return res.status(500).json({ message: "Checkout failed; reservation released" });
  }
});

router.post("/", async (req, res) => {
  const userId = req.header("x-user-id");
  const idempotencyKey = req.header("idempotency-key");

  if (!isUuid(userId) || !idempotencyKey) {
    return res.status(400).json({
      message: "x-user-id (uuid) and idempotency-key headers are required",
    });
  }

  try {
    const order = await checkout(userId, idempotencyKey);
    return res.status(201).json({ data: order });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "CART_EMPTY") {
      return res.status(409).json({ message: "Cart is empty" });
    }
    if (code === "INSUFFICIENT_STOCK") {
      return res.status(409).json({ message: "Insufficient stock" });
    }
    if (code === "IDEMPOTENCY_KEY_CONFLICT") {
      return res.status(409).json({ message: "Idempotency key already used" });
    }
    console.error("Checkout failed", error);
    return res.status(500).json({ message: "Checkout failed" });
  }
});

router.get("/", async (req, res) => {
  const userId = req.header("x-user-id");
  if (!isUuid(userId)) {
    return res.status(400).json({ message: "x-user-id (uuid) is required" });
  }
  const orders = await AppDataSource.getRepository(Order).find({
    where: { userId },
    order: { createdAt: "DESC" },
  });
  return res.json({ data: orders });
});

export default router;
