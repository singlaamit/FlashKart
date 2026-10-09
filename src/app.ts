import "dotenv/config";
import express from "express";
import { AppDataSource } from "./data-source";
import cartRoutes from "./routes/cart.routes";
import orderRoutes from "./routes/order.routes";
import productRoutes from "./routes/product.routes";
import userRoutes from "./routes/user.routes";

async function bootstrap() {
  await AppDataSource.initialize();

  const app = express();
  app.use(express.json());

  app.use("/users", userRoutes);
  app.use("/products", productRoutes);
  app.use("/cart", cartRoutes);
  app.use("/orders", orderRoutes);
  app.use("/order", orderRoutes); // /order/checkout

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.listen(process.env.PORT ?? 3000, () => {
    console.log("FlashKart backend started");
  });
}

bootstrap().catch((error) => {
  console.error("Application startup failed", error);
  process.exit(1);
});
