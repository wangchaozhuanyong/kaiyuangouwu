import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { CartCommandStatus } from '../cart-command.types';

import { StorefrontCart } from './storefront-cart.entity';

/** Terminal acknowledgements only. Never persist command bodies or customer contact data. */
@Entity()
@Index('IDX_cart_command_identity', ['cartId', 'commandId'], { unique: true })
export class StorefrontCartCommandReceipt extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontCartCommandReceipt>) {
        super(input);
    }

    @ManyToOne(() => StorefrontCart, { onDelete: 'CASCADE' })
    cart: StorefrontCart;

    @EntityId()
    cartId: ID;

    @Column('varchar', { length: 80 })
    commandId: string;

    @Column('varchar', { length: 64, nullable: true })
    digest: string | null;

    @Column('varchar', { length: 16 })
    status: Exclude<CartCommandStatus, 'NOT_FOUND'>;

    @Column('int')
    appliedRevision: number;

    @Column('varchar', { length: 100, nullable: true })
    errorCode: string | null;
}
