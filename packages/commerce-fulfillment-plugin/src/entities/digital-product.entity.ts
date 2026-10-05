import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { DigitalDeliveryMode } from '../auto-card.constants';
import { DigitalStockPolicy } from '../types';

@Entity({ name: 'digital_variant_config' })
@Index('IDX_digital_config_channel_variant', ['channelId', 'productVariantId'], { unique: true })
export class DigitalVariantConfig extends VendureEntity {
    constructor(input?: DeepPartial<DigitalVariantConfig>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() productVariantId: ID;
    @Column({ type: 'varchar', length: 24 }) deliveryMode: DigitalDeliveryMode;
    @Column({ type: 'varchar', length: 24 }) stockPolicy: DigitalStockPolicy;
    /** Unreserved remaining units. Consuming a held unit does not deduct it again. */
    @Column({ type: 'int', default: 0 }) availableQuantity: number;
    @EntityId({ nullable: true }) fileVersionId: ID | null;
    @Column({ type: 'varchar', length: 24, default: 'ACTIVE' }) migrationState: 'ACTIVE' | 'PREPARED';
}

@Entity({ name: 'digital_order_reservation' })
@Index('IDX_digital_reservation_line', ['orderLineId'], { unique: true })
@Index('IDX_digital_reservation_expiry', ['state', 'expiresAt'])
export class DigitalOrderReservation extends VendureEntity {
    constructor(input?: DeepPartial<DigitalOrderReservation>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() orderId: ID;
    @EntityId() orderLineId: ID;
    @EntityId() configId: ID;
    @Column({ type: 'varchar', length: 24 }) deliveryMode: DigitalDeliveryMode;
    @Column({ type: 'varchar', length: 24 }) stockPolicy: DigitalStockPolicy;
    @Column({ type: 'int' }) quantity: number;
    @Column({ type: 'int', default: 0 }) releasedQuantity: number;
    @Column({ type: 'int', default: 0 }) consumedQuantity: number;
    @Column({ type: 'varchar', length: 24, default: 'HELD' }) state: 'HELD' | 'CONSUMED' | 'RELEASED';
    @Column({ type: Date }) expiresAt: Date;
    @Column({ type: 'text', default: () => "('[]')" }) poolItemIdsJson: string;
    @EntityId({ nullable: true }) fileVersionId: ID | null;
}

@Entity({ name: 'digital_quota_movement' })
@Index('IDX_digital_quota_event', ['channelId', 'eventKey'], { unique: true })
export class DigitalQuotaMovement extends VendureEntity {
    constructor(input?: DeepPartial<DigitalQuotaMovement>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() productVariantId: ID;
    @Column({ type: 'varchar', length: 160 }) eventKey: string;
    @Column({ type: 'varchar', length: 24 }) type: 'ADJUST' | 'HOLD' | 'RELEASE' | 'MIGRATE';
    @Column({ type: 'int' }) quantity: number;
    @Column({ type: 'int' }) availableAfter: number;
    @Column({ type: 'varchar', length: 64, nullable: true }) actorId: string | null;
}

@Entity({ name: 'digital_file_version' })
@Index('IDX_digital_file_channel', ['channelId'])
export class DigitalFileVersion extends VendureEntity {
    constructor(input?: DeepPartial<DigitalFileVersion>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @Column({ type: 'varchar', length: 255 }) fileName: string;
    @Column({ type: 'varchar', length: 255 }) storageKey: string;
    @Column({ type: 'int' }) size: number;
    @Column({ type: 'varchar', length: 64 }) sha256: string;
}

@Entity({ name: 'checkout_resource_hold' })
@Index('IDX_checkout_resource_order', ['orderId'], { unique: true })
export class CheckoutResourceHold extends VendureEntity {
    constructor(input?: DeepPartial<CheckoutResourceHold>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() orderId: ID;
    @Column({ type: 'varchar', length: 24, default: 'HELD' }) state:
        'HELD' | 'PAYING' | 'CONFIRMED' | 'RELEASED' | 'REVIEW';
    @Column({ type: Date }) expiresAt: Date;
    @Column({ type: 'varchar', length: 1000, nullable: true }) reviewReason: string | null;
}

@Entity({ name: 'digital_receipt_access' })
@Index('IDX_digital_receipt_line', ['channelId', 'orderLineId'], { unique: true })
export class DigitalReceiptAccess extends VendureEntity {
    constructor(input?: DeepPartial<DigitalReceiptAccess>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() orderId: ID;
    @EntityId() orderLineId: ID;
    @Column({ type: 'int' }) claimedQuantity: number;
    @Column({ type: 'varchar', length: 64, nullable: true }) actorId: string | null;
}
