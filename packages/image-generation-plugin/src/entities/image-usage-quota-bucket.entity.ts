import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

@Entity({ name: 'image_usage_quota_bucket' })
@Index(
    'IDX_image_usage_quota_bucket_unique',
    ['channelId', 'customerId', 'quotaType', 'modelCode', 'windowKey'],
    { unique: true },
)
export class ImageUsageQuotaBucket extends VendureEntity {
    constructor(input?: DeepPartial<ImageUsageQuotaBucket>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_usage_quota_bucket_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_image_usage_quota_bucket_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'varchar', length: 32 })
    quotaType: string;

    @Column({ type: 'varchar', length: 48, default: '' })
    modelCode: string;

    @Column({ type: 'varchar', length: 32 })
    windowKey: string;

    @Column({ type: Date })
    windowStartsAt: Date;

    @Column({ type: Date })
    windowEndsAt: Date;

    @Column('int')
    limitSnapshot: number;

    @Column('boolean', { default: false })
    unlimited: boolean;

    @Column('int', { default: 0 })
    reserved: number;

    @Column('int', { default: 0 })
    consumed: number;

    @Column('int', { default: 0 })
    released: number;

    @VersionColumn()
    version: number;
}
