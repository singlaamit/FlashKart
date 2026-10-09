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
import { Cart } from "./Cart";
import { Product } from "./Product";

@Entity("cart_items")
@Check('"quantity" > 0')
export class CartItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column("uuid")
  cartId!: string;

  @ManyToOne(() => Cart, { onDelete: "CASCADE" })
  @JoinColumn({ name: "cartId" })
  cart!: Cart;

  @Index()
  @Column("uuid")
  productId!: string;

  @ManyToOne(() => Product, { nullable: false })
  @JoinColumn({ name: "productId" })
  product!: Product;

  @Column("integer")
  quantity!: number;

  @Column({ type: "timestamptz", nullable: true })
  reservationExpiresAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
