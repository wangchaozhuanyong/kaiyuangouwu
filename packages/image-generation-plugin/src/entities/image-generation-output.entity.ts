import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, VersionColumn } from 'typeorm';

import { ImageGenerationJob } from './image-generation-job.entity';
import { ImagePrivateAsset } from './image-private-asset.entity';

@Entity({ name: 'image_generation_output' })
@Index('IDX_image_generation_output_job_index', ['jobId', 'outputIndex'], { unique: true })
@Index('IDX_image_generation_output_state_updated', ['state', 'updatedAt'])
export class ImageGenerationOutput extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationOutput>) {
        super(input);
    }

    @ManyToOne(() => ImageGenerationJob, job => job.outputs, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'jobId', foreignKeyConstraintName: 'FK_image_generation_output_job' })
    job: ImageGenerationJob;

    @EntityId()
    jobId: ID;

    @Column('int')
    outputIndex: number;

    @Column({ type: 'varchar', length: 24, default: 'QUEUED' })
    state: string;

    @Column('int', { default: 0 })
    attemptCount: number;

    @Column({ type: 'varchar', length: 160 })
    providerIdempotencyKey: string;

    @Column({ type: 'varchar', length: 200, nullable: true })
    providerRequestId: string | null;

    @ManyToOne(() => ImagePrivateAsset, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'assetId', foreignKeyConstraintName: 'FK_image_generation_output_asset' })
    asset: ImagePrivateAsset | null;

    @EntityId({ nullable: true })
    assetId: ID | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;

    @Column({ type: Date, nullable: true })
    unknownAt: Date | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @Column('boolean', { default: false })
    walletSettled: boolean;

    @Column({ type: 'varchar', length: 16, default: 'PENDING' })
    billingMode: string;

    @Money({ default: 0 })
    chargeAmount: number;

    @Column({ type: Date, nullable: true })
    refundedAt: Date | null;

    @VersionColumn()
    version: number;
}
