import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import {
    Channel,
    Customer,
    EntityId,
    Order,
    OrderLine,
    Product,
    ProductVariant,
    VendureEntity,
} from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { StorefrontReviewState } from '../review.constants';

@Entity({ name: 'storefront_review' })
@Index('IDX_storefront_review_channel_state_created', ['channelId', 'state', 'createdAt'])
@Index('IDX_storefront_review_product_state_created', ['productId', 'state', 'createdAt'])
@Index('IDX_storefront_review_customer_created', ['customerId', 'createdAt'])
@Index('IDX_storefront_review_order_line', ['orderLineId'], { unique: true })
export class StorefrontReview extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontReview>) {
        super(input);
    }

    get verifiedPurchase(): boolean {
        return true;
    }

    @Column({ type: 'varchar', length: 16, default: 'PENDING' })
    state: StorefrontReviewState;

    @Column({ type: 'int' })
    rating: number;

    @Column({ type: 'varchar', length: 120 })
    title: string;

    @Column({ type: 'text' })
    body: string;

    @Column({ type: 'varchar', length: 120 })
    customerName: string;

    @Column({ type: 'varchar', length: 255 })
    productName: string;

    @Column({ type: 'varchar', length: 255 })
    sku: string;

    @Column({ type: 'text', nullable: true })
    merchantResponse: string | null;

    @Column({ type: Date, nullable: true })
    moderatedAt: Date | null;

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_storefront_review_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_storefront_review_customer' })
    customer: Customer | null;

    @EntityId({ nullable: true })
    customerId: ID | null;

    @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'orderId', foreignKeyConstraintName: 'FK_storefront_review_order' })
    order: Order | null;

    @EntityId({ nullable: true })
    orderId: ID | null;

    @ManyToOne(() => OrderLine, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'orderLineId', foreignKeyConstraintName: 'FK_storefront_review_order_line' })
    orderLine: OrderLine | null;

    @EntityId({ nullable: true })
    orderLineId: ID | null;

    @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'productId', foreignKeyConstraintName: 'FK_storefront_review_product' })
    product: Product | null;

    @EntityId({ nullable: true })
    productId: ID | null;

    @ManyToOne(() => ProductVariant, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({
        name: 'productVariantId',
        foreignKeyConstraintName: 'FK_storefront_review_product_variant',
    })
    productVariant: ProductVariant | null;

    @EntityId({ nullable: true })
    productVariantId: ID | null;
}
