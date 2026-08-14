import { DeepPartial, EntityId, ID, OrderLine, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StorefrontCart } from './storefront-cart.entity';

@Entity()
@Index('IDX_storefront_cart_line_variant', ['cartId', 'productVariantId'], { unique: true })
export class StorefrontCartLine extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontCartLine>) {
        super(input);
    }

    @ManyToOne(() => StorefrontCart, cart => cart.lines, { onDelete: 'CASCADE' })
    cart: StorefrontCart;

    @EntityId()
    cartId: ID;

    @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE' })
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @Column('int')
    quantity: number;

    @Column('boolean', { default: true })
    selected: boolean;

    @ManyToOne(() => OrderLine, { nullable: true, onDelete: 'SET NULL' })
    orderLine: OrderLine | null;

    @Index('IDX_storefront_cart_line_order_line', { unique: true })
    @EntityId({ nullable: true })
    orderLineId: ID | null;
}
