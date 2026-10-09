import { Router } from "express";
import { AppDataSource } from "../data-source";
import { User } from "../entities/User";

const router = Router();

router.post("/", async (req, res) => {
  const { email, name } = req.body ?? {};
  if (typeof email !== "string" || typeof name !== "string" || !email || !name) {
    return res.status(400).json({ message: "email and name are required" });
  }

  const repo = AppDataSource.getRepository(User);
  if (await repo.existsBy({ email })) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const user = await repo.save(repo.create({ email, name }));
  return res.status(201).json({ data: user });
});

export default router;
