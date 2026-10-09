import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from "typeorm";

@Entity("products")
@Check('"stock" >= 0')
export class Product {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column("decimal", { precision: 12, scale: 2 })
  price!: string;

  @Column({ type: "integer", default: 0 })
  stock!: number;

  @Column({ default: true })
  isActive!: boolean;

  // End of the flash sale; null means no deadline.
  @Column({ type: "timestamptz", nullable: true })
  saleEndsAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
