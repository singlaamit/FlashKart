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

@Entity("orders")
@Check('"totalAmount" >= 0')
export class Order {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column("uuid")
  userId!: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Index({ unique: true })
  @Column()
  idempotencyKey!: string;

  // Set for orders created from a reservation. Unique, so one reservation
  // can never become two orders (NULLs are allowed for cart orders).
  @Index({ unique: true })
  @Column({ type: "uuid", nullable: true })
  reservationId!: string | null;

  @Column({ type: "uuid", nullable: true })
  productId!: string | null;

  @Column({ type: "integer", nullable: true })
  quantity!: number | null;

  @Column("decimal", { precision: 12, scale: 2 })
  totalAmount!: string;

  @Column({
    type: "varchar",
    default: "pending",
  })
  status!: "pending" | "confirmed" | "cancelled";

  @CreateDateColumn()
  createdAt!: Date;
}
