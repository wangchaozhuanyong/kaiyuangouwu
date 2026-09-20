import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'marketing_campaign_cost' })
@Index('UQ_marketing_campaign_cost_key', ['channelId', 'idempotencyKey'], { unique: true })
@Index('IDX_marketing_campaign_cost_report', ['channelId', 'businessDate', 'currencyCode'])
export class MarketingCampaignCost extends VendureEntity {
    constructor(input?: DeepPartial<MarketingCampaignCost>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_marketing_campaign_cost_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 10 })
    businessDate: string;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Column({ type: 'varchar', length: 100 })
    source: string;

    @Column({ type: 'varchar', length: 100 })
    medium: string;

    @Column({ type: 'varchar', length: 160 })
    campaign: string;

    @Column({ type: 'bigint' })
    amountMicrounits: string;

    @Column({ type: 'varchar', length: 96 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 128, nullable: true })
    actorUserId: string | null;

    @Column({ type: 'varchar', length: 500 })
    reason: string;
}
