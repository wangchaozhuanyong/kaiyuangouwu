import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity('gpt_recharge_config')
@Index('UQ_gpt_recharge_config_channel', ['channelId'], { unique: true })
export class GptRechargeConfig extends VendureEntity {
    constructor(input?: DeepPartial<GptRechargeConfig>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @Column({ type: 'int', default: 0 }) revision: number;
    @Column({ type: 'boolean', default: false }) enabled: boolean;
    @Column({ type: 'varchar', length: 255 }) upstreamOrigin: string;
    @Column({ type: 'text' }) encryptedServiceKey: string;
}

@Entity('gpt_recharge_receipt')
@Index('UQ_gpt_recharge_receipt_code', ['channelId', 'codeFingerprint'], { unique: true })
@Index('UQ_gpt_recharge_receipt_public', ['publicId'], { unique: true })
export class GptRechargeReceipt extends VendureEntity {
    constructor(input?: DeepPartial<GptRechargeReceipt>) {
        super(input);
    }
    @EntityId() channelId: ID;
    @Column({ type: 'int', default: 0 }) revision: number;
    @Column({ type: 'varchar', length: 36 }) publicId: string;
    @Column({ type: 'varchar', length: 64 }) codeFingerprint: string;
    @Column({ type: 'varchar', length: 32, default: 'new' }) status: string;
    @Column({ type: 'varchar', length: 16, default: 'plus' }) plan: string;
    @Column({ type: Date, nullable: true }) upstreamUpdatedAt: Date | null;
    @Column({ type: 'text', nullable: true }) encryptedUpstreamTask: string | null;
}
