import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'physical_return_receipt' })
@Index('IDX_physical_return_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_physical_return_line', ['channelId', 'orderLineId'])
export class PhysicalReturnReceipt extends VendureEntity {
    constructor(input?: DeepPartial<PhysicalReturnReceipt>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @EntityId() requestId: ID;
    @EntityId() orderId: ID;
    @EntityId() orderLineId: ID;
    @EntityId() stockLocationId: ID;
    @Column({ type: 'varchar', length: 80 }) idempotencyKey: string;
    @Column({ type: 'int' }) quantity: number;
    @Column({ type: 'varchar', length: 16 }) quality: 'GOOD' | 'DAMAGED' | 'EXPIRED';
    @Column({ type: 'varchar', length: 16 }) state: 'RECORDED' | 'RECEIVED';
    @Column({ type: 'varchar', length: 64, nullable: true }) actorId: string | null;
}
