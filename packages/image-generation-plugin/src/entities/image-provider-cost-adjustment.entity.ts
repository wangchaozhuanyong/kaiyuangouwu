/* eslint-disable import/order -- The repository import organizer keeps this type-only relative import last. */
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import type { ReviewedSupplierBill } from '../image-provider-billing-review';

// Snapshot identifiers deliberately have no cascade-delete relation: audit evidence survives its target.
@Entity({ name: 'image_provider_cost_adjustment' })
@Index('IDX_image_cost_adjustment_batch_target', ['batchId', 'targetKey'], { unique: true })
@Index('IDX_image_cost_adjustment_target', ['targetKey', 'id'])
@Index('IDX_image_cost_adjustment_channel', ['channelId', 'recordType', 'recordIdSnapshot'])
export class ImageProviderCostAdjustment extends VendureEntity {
    constructor(input?: DeepPartial<ImageProviderCostAdjustment>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 64 })
    channelId: string;

    @Column({ type: 'varchar', length: 64 })
    targetKey: string;

    @Column({ type: 'varchar', length: 32 })
    recordType: string;

    @Column({ type: 'varchar', length: 64 })
    recordIdSnapshot: string;

    @Column({ type: 'varchar', length: 128 })
    batchId: string;

    @Column({ type: 'varchar', length: 128 })
    reviewer: string;

    @Column({ type: 'varchar', length: 500 })
    authorizationRef: string;

    @Column({ type: 'varchar', length: 500 })
    reason: string;

    @Column({ type: 'varchar', length: 64 })
    oldValueHash: string;

    @Column({ type: 'varchar', length: 64 })
    sourceHash: string;

    @Column({ type: 'varchar', length: 64 })
    entryHash: string;

    @Column({ type: 'varchar', length: 32 })
    matchingStatus: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    previousAdjustmentId: string | null;
    @Column({ type: Date })
    reviewedAt: Date;
    @Column('int', { nullable: true })
    oldCostMicrounits: number | null;
    @Column({ type: 'varchar', length: 3, nullable: true })
    oldCurrency: string | null;
    @Column('int', { nullable: true })
    newCostMicrounits: number | null;
    @Column({ type: 'varchar', length: 3, nullable: true })
    newCurrency: string | null;
    @Column({ type: 'simple-json' })
    supplierBills: ReviewedSupplierBill[];
}
