import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
  Check,
} from "typeorm";
import { User } from "./User";
import { Product } from "./Product";

@Entity("reservations")
@Check('"quantity" > 0')
export class Reservation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column("uuid")
  productId!: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: "productId" })
  product!: Product;

  @Index()
  @Column("uuid")
  userId!: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column("integer")
  quantity!: number;

  // A reservation only holds stock while status is "active" and expiresAt is in the future.
  @Column({ type: "varchar", default: "active" })
  status!: "active" | "consumed" | "released";

  @Index()
  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
