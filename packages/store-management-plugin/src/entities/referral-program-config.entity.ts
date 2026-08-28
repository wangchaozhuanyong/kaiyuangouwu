import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, CurrencyCode, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'referral_program_config' })
@Index('IDX_referral_program_config_channel', ['channelId'], { unique: true })
export class ReferralProgramConfig extends VendureEntity {
    constructor(input?: DeepPartial<ReferralProgramConfig>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_referral_program_config_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column('int', { default: 500 })
    rewardRateBps: number;

    @Column('int', { default: 7 })
    releaseDelayDays: number;

    @Money({ default: 0 })
    minimumOrderAmount: number;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @Money({ nullable: true })
    maxRewardPerOrder: number | null;

    @Column('boolean', { default: true })
    allowBalanceSpend: boolean;

    @Column('int', { default: 30 })
    attributionWindowDays: number;

    @Column({ type: 'varchar', length: 64, default: 'BRAND_MINIMAL' })
    defaultPosterTemplate: string;
}
