import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_prompt_optimization_attempt' })
@Index('IDX_image_prompt_attempt_call', ['callId'], { unique: true })
@Index('IDX_image_prompt_attempt_order', ['optimizationIdSnapshot', 'attemptNumber'], { unique: true })
@Index('IDX_image_prompt_attempt_channel', ['channelId', 'createdAt'])
export class ImagePromptOptimizationAttempt extends VendureEntity {
    constructor(input?: DeepPartial<ImagePromptOptimizationAttempt>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_prompt_attempt_channel' })
    channel: Channel;
    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 64 })
    optimizationIdSnapshot: string;
    @Column('int')
    attemptNumber: number;
    @Column({ type: 'varchar', length: 16 })
    stage: string;
    @Column({ type: 'varchar', length: 24 })
    outcome: string;
    @Column({ type: 'varchar', length: 160 })
    modelId: string;
    @Column({ type: 'varchar', length: 24 })
    providerScope: string;
    @Column({ type: 'varchar', length: 64 })
    credentialCodeSnapshot: string;
    @Column({ type: 'varchar', length: 120 })
    credentialNameSnapshot: string;
    @Column({ type: 'varchar', length: 8 })
    credentialLast4Snapshot: string;
    @Column({ type: 'varchar', length: 160, nullable: true })
    credentialSelectionReason: string | null;
    @Column({ type: 'varchar', length: 200, nullable: true })
    providerRequestId: string | null;

    @Column({ type: 'varchar', length: 36 })
    callId: string;

    @Column({ type: 'varchar', length: 200, nullable: true })
    headerRequestId: string | null;

    @Column({ type: 'varchar', length: 48, nullable: true })
    headerRequestIdSource: string | null;

    @Column({ type: 'varchar', length: 200, nullable: true })
    modelResponseId: string | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    costSource: string | null;

    @Column({ type: 'simple-json', nullable: true })
    reportedCostEvidence: { amount: number; currency: string | null; field: string } | null;

    @Column('int', { nullable: true })
    httpStatus: number | null;
    @Column('int', { default: 0 })
    latencyMs: number;
    @Column('int', { nullable: true })
    actualCostMicrounits: number | null;
    @Column({ type: 'varchar', length: 3, nullable: true })
    costCurrency: string | null;
    @Column({ type: 'simple-json', nullable: true })
    usage: Record<string, any> | null;
    @Column({ type: Date, nullable: true })
    completedAt: Date | null;
    @Column({ type: 'varchar', length: 100, nullable: true })
    errorMessage: string | null;
}
