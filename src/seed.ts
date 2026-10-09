import "dotenv/config";
import { AppDataSource } from "./data-source";
import { Product } from "./entities/Product";
import { User } from "./entities/User";

const USERS = [
  { email: "alice@example.com", name: "Alice Johnson" },
  { email: "bob@example.com", name: "Bob Smith" },
  { email: "carol@example.com", name: "Carol Lee" },
];

const PRODUCTS = [
  { name: "Wireless Mouse", price: "19.99", stock: 50 },
  { name: "Mechanical Keyboard", price: "89.00", stock: 25 },
  { name: "USB-C Hub", price: "34.50", stock: 40 },
  { name: "27\" Monitor", price: "249.99", stock: 10 },
  { name: "Noise-Cancelling Headphones", price: "159.00", stock: 15 },
  { name: "Flash Sale Webcam", price: "49.99", stock: 3 },
];

const SALE_MINUTES = 60;

// Idempotent: existing users (by email) and products (by name) are left untouched.
async function seed() {
  await AppDataSource.initialize();
  const users = AppDataSource.getRepository(User);
  const products = AppDataSource.getRepository(Product);

  for (const u of USERS) {
    if (!(await users.existsBy({ email: u.email }))) await users.save(users.create(u));
  }
  for (const p of PRODUCTS) {
    if (!(await products.existsBy({ name: p.name }))) await products.save(products.create(p));
    // Refresh the sale deadline on every run so the countdown demo is never already over.
    await products.update(
      { name: p.name },
      { saleEndsAt: new Date(Date.now() + SALE_MINUTES * 60_000) },
    );
  }

  console.log("Users:");
  console.table((await users.find()).map(({ id, email, name }) => ({ id, email, name })));
  console.log("Products:");
  console.table(
    (await products.find()).map(({ id, name, price, stock }) => ({ id, name, price, stock })),
  );
  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error("Seeding failed", error);
  process.exit(1);
});
