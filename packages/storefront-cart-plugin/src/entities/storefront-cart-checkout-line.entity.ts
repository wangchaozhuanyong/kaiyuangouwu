import { DeepPartial, EntityId, ID, ProductVariant, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { StorefrontCartCheckout } from './storefront-cart-checkout.entity';
import { StorefrontCartLine } from './storefront-cart-line.entity';

@Entity()
@Index('IDX_storefront_checkout_line_variant', ['checkoutId', 'productVariantId'], { unique: true })
export class StorefrontCartCheckoutLine extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontCartCheckoutLine>) {
        super(input);
    }

    @ManyToOne(() => StorefrontCartCheckout, checkout => checkout.lines, { onDelete: 'CASCADE' })
    checkout: StorefrontCartCheckout;

    @EntityId()
    checkoutId: ID;

    @ManyToOne(() => StorefrontCartLine, { nullable: true, onDelete: 'SET NULL' })
    cartLine: StorefrontCartLine | null;

    @Index('IDX_storefront_checkout_line_cart_line')
    @EntityId({ nullable: true })
    cartLineId: ID | null;

    @ManyToOne(() => ProductVariant)
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @Column('int')
    quantity: number;
}
