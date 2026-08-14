import { DeepPartial, EntityId, ID, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

import { StorefrontCartCheckoutState } from '../types';
import { StorefrontCartCheckoutLine } from './storefront-cart-checkout-line.entity';
import { StorefrontCart } from './storefront-cart.entity';

@Entity()
export class StorefrontCartCheckout extends VendureEntity {
    readonly __typename = 'StorefrontCartCheckout';

    constructor(input?: DeepPartial<StorefrontCartCheckout>) {
        super(input);
    }

    @ManyToOne(() => StorefrontCart, cart => cart.checkouts, { onDelete: 'NO ACTION' })
    cart: StorefrontCart;

    @Index('IDX_storefront_cart_checkout_cart')
    @EntityId()
    cartId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    order: Order;

    @Index('IDX_storefront_cart_checkout_order', { unique: true })
    @EntityId()
    orderId: ID;

    @Column('int')
    cartRevision: number;

    @Column('varchar', { length: 20, default: 'PREPARED' })
    state: StorefrontCartCheckoutState;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @OneToMany(() => StorefrontCartCheckoutLine, line => line.checkout)
    lines: StorefrontCartCheckoutLine[];
}
