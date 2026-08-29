import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, VersionColumn } from 'typeorm';

import { ImageGenerationOutput } from './image-generation-output.entity';
import { ImageModelConfig } from './image-model-config.entity';
import { ImagePrivateAsset } from './image-private-asset.entity';

@Entity({ name: 'image_generation_job' })
@Index('IDX_image_generation_job_idempotency', ['channelId', 'customerId', 'idempotencyKey'], {
    unique: true,
})
@Index('IDX_image_generation_job_customer_created', ['customerId', 'createdAt'])
@Index('IDX_image_generation_job_state_created', ['state', 'createdAt'])
export class ImageGenerationJob extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationJob>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_generation_job_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_image_generation_job_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @ManyToOne(() => ImageModelConfig, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'modelConfigId', foreignKeyConstraintName: 'FK_image_generation_job_model' })
    modelConfig: ImageModelConfig;

    @EntityId()
    modelConfigId: ID;

    @ManyToOne(() => ImagePrivateAsset, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'referenceAssetId', foreignKeyConstraintName: 'FK_image_generation_job_reference' })
    referenceAsset: ImagePrivateAsset | null;

    @EntityId({ nullable: true })
    referenceAssetId: ID | null;

    @Column({ type: 'varchar', length: 64 })
    idempotencyKey: string;

    @Column({ type: 'varchar', length: 48 })
    modelCodeSnapshot: string;

    @Column({ type: 'varchar', length: 120 })
    modelNameSnapshot: string;

    @Column({ type: 'varchar', length: 160 })
    officialModelIdSnapshot: string;

    @Column({ type: 'varchar', length: 160 })
    providerModelIdSnapshot: string;

    @Column({ type: 'varchar', length: 32 })
    protocolSnapshot: string;

    @Column({ type: 'varchar', length: 24 })
    providerScopeSnapshot: string;

    @Column({ type: 'varchar', length: 64 })
    providerCredentialFingerprint: string;

    @Column('boolean', { default: false })
    providerIdempotencySupportedSnapshot: boolean;

    @Column({ type: 'text' })
    originalPrompt: string;

    @Column({ type: 'text' })
    finalPrompt: string;

    @Column({ type: 'simple-json', nullable: true })
    promptSpec: Record<string, any> | null;

    @Column({ type: 'varchar', length: 64 })
    promptSkillHash: string;

    @Column({ type: 'varchar', length: 24, default: 'NONE' })
    referenceMode: string;

    @Column({ type: 'varchar', length: 8 })
    aspectRatio: string;

    @Column('int')
    quantity: number;

    @Money()
    unitPriceSnapshot: number;

    @Money()
    reservedAmount: number;

    @Money({ default: 0 })
    capturedAmount: number;

    @Money({ default: 0 })
    releasedAmount: number;

    @Column({ type: 'varchar', length: 3 })
    currencyCode: CurrencyCode;

    @EntityId({ nullable: true })
    walletUsageId: ID | null;

    @Column({ type: 'varchar', length: 24, default: 'QUEUED' })
    state: string;

    @Column({ type: 'varchar', length: 32 })
    termsVersion: string;

    @Column({ type: Date })
    termsAcceptedAt: Date;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;

    @Column({ type: Date, nullable: true })
    completedAt: Date | null;

    @OneToMany(() => ImageGenerationOutput, output => output.job)
    outputs: ImageGenerationOutput[];

    @VersionColumn()
    version: number;
}
