import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, Money, Order, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity('storefront_usdt_checkout_quote')
@Index('IDX_storefront_usdt_quote_order_expiry', ['orderId', 'expiresAt'])
export class StorefrontUsdtCheckoutQuote extends VendureEntity {
    constructor(input?: DeepPartial<StorefrontUsdtCheckoutQuote>) {
        super(input);
    }

    @ManyToOne(() => Channel, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Order, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'orderId' })
    order: Order;

    @EntityId()
    orderId: ID;

    @Column({ type: 'varchar', length: 3 })
    fiatCurrencyCode: string;

    @Money()
    fiatAmount: number;

    @Column({ type: 'float' })
    fiatPerUsdtRate: number;

    @Column({ type: 'int', default: 0 })
    markupBps: number;

    @Column({ type: 'decimal', precision: 24, scale: 6 })
    usdtAmount: string;

    @Column({ type: 'varchar', length: 120 })
    source: string;

    @Column({ type: Date })
    expiresAt: Date;
}
