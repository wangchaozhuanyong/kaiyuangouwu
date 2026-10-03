import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'auto_card_supply_grant' })
@Index('IDX_auto_card_supply_target', ['channelId', 'productVariantId'], { unique: true })
export class AutoCardSupplyGrant extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardSupplyGrant>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() productVariantId: ID;
    @EntityId() sourceChannelId: ID;
    @EntityId() configId: ID;
    @Column({ type: 'boolean', default: true }) enabled: boolean;
    @Column({ type: 'int', default: 1 }) version: number;
}

@Entity({ name: 'auto_card_supply_snapshot' })
@Index('IDX_auto_card_supply_order_line', ['orderLineId'], { unique: true })
export class AutoCardSupplySnapshot extends VendureEntity {
    constructor(input?: DeepPartial<AutoCardSupplySnapshot>) {
        super(input);
    }
    @EntityId() orderLineId: ID;
    @EntityId() orderId: ID;
    @EntityId() channelId: ID;
    @EntityId() sourceChannelId: ID;
    @EntityId() configId: ID;
    @EntityId({ nullable: true }) grantId: ID | null;
    @Column({ type: 'int', nullable: true }) grantVersion: number | null;
    @Column({ type: 'int' }) quantity: number;
    @Column({ type: 'simple-json' }) configSnapshot: {
        delimiter: string;
        fieldsJson: string;
        instructions: string;
        instructionsZh: string | null;
        instructionsEn: string | null;
    };
}
