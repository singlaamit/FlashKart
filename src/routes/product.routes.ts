import { Router } from "express";
import { AppDataSource } from "../data-source";
import { Product } from "../entities/Product";

const router = Router();

router.post("/", async (req, res) => {
  const { name, price, stock = 0 } = req.body ?? {};
  const priceNum = Number(price);

  if (
    typeof name !== "string" ||
    !name ||
    !Number.isFinite(priceNum) ||
    priceNum < 0 ||
    !Number.isSafeInteger(stock) ||
    stock < 0
  ) {
    return res.status(400).json({
      message: "name, non-negative price and non-negative integer stock required",
    });
  }

  const repo = AppDataSource.getRepository(Product);
  const product = await repo.save(
    repo.create({ name, price: priceNum.toFixed(2), stock }),
  );
  return res.status(201).json({ data: product });
});

// `available` = stock minus active, unexpired reservations (what a buyer can still reserve).
router.get("/", async (_req, res) => {
  const products = await AppDataSource.query(
    `SELECT p.*,
            GREATEST(p.stock - COALESCE(r.reserved, 0), 0)::int AS available
     FROM products p
     LEFT JOIN (
       SELECT "productId", SUM(quantity) AS reserved FROM reservations
       WHERE status = 'active' AND "expiresAt" > now()
       GROUP BY "productId"
     ) r ON r."productId" = p.id
     WHERE p."isActive" = true`,
  );
  return res.json({ data: products });
});

export default router;
