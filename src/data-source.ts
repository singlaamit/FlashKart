import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "./entities/User";
import { Product } from "./entities/Product";
import { Cart } from "./entities/Cart";
import { CartItem } from "./entities/CartItem";
import { Order } from "./entities/Order";
import { Reservation } from "./entities/Reservation";

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: [User, Product, Cart, CartItem, Order, Reservation],
  // Dev convenience only; use migrations in production.
  synchronize: process.env.NODE_ENV !== "production",
  migrations: ["src/migrations/*.ts"],
});
