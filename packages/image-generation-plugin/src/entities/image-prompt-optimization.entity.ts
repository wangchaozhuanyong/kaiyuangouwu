import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, Money, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import type { ImagePricingSnapshot } from '../image-billing-quote';

@Entity({ name: 'image_prompt_optimization' })
@Index('IDX_image_prompt_optimization_customer_created', ['channelId', 'customerId', 'createdAt'])
@Index('IDX_image_prompt_optimization_idempotency', ['channelId', 'customerId', 'idempotencyKey'], {
    unique: true,
})
export class ImagePromptOptimization extends VendureEntity {
    constructor(input?: DeepPartial<ImagePromptOptimization>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_prompt_optimization_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @ManyToOne(() => Customer, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'customerId', foreignKeyConstraintName: 'FK_image_prompt_optimization_customer' })
    customer: Customer;

    @EntityId()
    customerId: ID;

    @Column({ type: 'text' })
    inputPrompt: string;

    @Column({ type: 'text' })
    optimizedPrompt: string;

    @Column({ type: 'simple-json' })
    promptSpec: Record<string, any>;

    @Column({ type: 'varchar', length: 16 })
    source: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    optimizerModelId: string | null;

    @Column({ type: 'varchar', length: 64 })
    promptSkillHash: string;

    @Column({ type: 'varchar', length: 48 })
    recommendedModelCode: string;

    @Column({ type: 'varchar', length: 300 })
    recommendationReason: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    idempotencyKey: string | null;

    @Column({ type: 'varchar', length: 16, default: 'FREE' })
    billingMode: string;

    @Money({ default: 0 })
    chargedAmount: number;

    @Column({ type: 'simple-json', nullable: true })
    pricingSnapshot: ImagePricingSnapshot | null;

    @Column({ type: 'varchar', length: 3, default: 'CNY' })
    currencyCode: CurrencyCode;

    @EntityId({ nullable: true })
    walletUsageId: ID | null;

    @EntityId({ nullable: true })
    quotaEventId: ID | null;

    @Column('int', { nullable: true })
    inputTokens: number | null;

    @Column('int', { nullable: true })
    outputTokens: number | null;

    @Column('int', { nullable: true })
    totalTokens: number | null;

    @Column('int', { nullable: true })
    actualCostMicrounits: number | null;

    @Column({ type: 'varchar', length: 3, nullable: true })
    costCurrency: string | null;

    @Column({ type: 'varchar', length: 200, nullable: true })
    providerRequestId: string | null;

    @Column({ type: 'varchar', length: 64, default: '' })
    credentialCodeSnapshot: string;

    @Column({ type: 'varchar', length: 120, default: '' })
    credentialNameSnapshot: string;

    @Column({ type: 'varchar', length: 8, default: '' })
    credentialLast4Snapshot: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    credentialSelectionReason: string | null;

    @Column('int', { default: 0 })
    upstreamCallCount: number;

    @Column('int', { default: 0 })
    latencyMs: number;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;
}
