import { Channel, DeepPartial, EntityId, ID, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

import { StorefrontCartOwnerType, StorefrontCartState } from '../types';
import { StorefrontCartCheckout } from './storefront-cart-checkout.entity';
import { StorefrontCartLine } from './storefront-cart-line.entity';

@Entity()
@Index('IDX_storefront_cart_owner', ['channelId', 'ownerType', 'ownerId'], { unique: true })
export class StorefrontCart extends VendureEntity {
    readonly __typename = 'StorefrontCart';

    constructor(input?: DeepPartial<StorefrontCart>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('varchar', { length: 16 })
    ownerType: StorefrontCartOwnerType;

    @EntityId()
    ownerId: ID;

    @Column('int', { default: 0 })
    revision: number;

    @Column('varchar', { length: 24, default: 'OPEN' })
    state: StorefrontCartState;

    @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
    checkoutOrder: Order | null;

    @Index('IDX_storefront_cart_active_order', { unique: true })
    @EntityId({ nullable: true })
    checkoutOrderId: ID | null;

    @Column('int', { nullable: true })
    projectedRevision: number | null;

    @Column('boolean', { default: false })
    initialized: boolean;

    @Index('IDX_storefront_cart_activity')
    @Column({ type: Date })
    lastActivityAt: Date;

    @OneToMany(() => StorefrontCartLine, line => line.cart)
    lines: StorefrontCartLine[];

    @OneToMany(() => StorefrontCartCheckout, checkout => checkout.cart)
    checkouts: StorefrontCartCheckout[];
}
