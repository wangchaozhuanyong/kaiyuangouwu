import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_generation_cost_event' })
@Index('IDX_image_generation_cost_output_attempt', ['outputIdSnapshot', 'attemptNumber'], { unique: true })
@Index('IDX_image_generation_cost_channel_created', ['channelId', 'createdAt'])
@Index('IDX_image_generation_cost_model_created', ['modelCodeSnapshot', 'createdAt'])
export class ImageGenerationCostEvent extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationCostEvent>) {
        super(input);
    }

    @ManyToOne(() => Channel, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'channelId', foreignKeyConstraintName: 'FK_image_generation_cost_channel' })
    channel: Channel;

    @EntityId()
    channelId: ID;

    @Column({ type: 'varchar', length: 64 })
    jobIdSnapshot: string;

    @Column({ type: 'varchar', length: 64 })
    outputIdSnapshot: string;

    @Column('int')
    attemptNumber: number;

    @Column({ type: 'varchar', length: 48 })
    modelCodeSnapshot: string;

    @Column({ type: 'varchar', length: 24 })
    providerScopeSnapshot: string;

    @Column({ type: 'varchar', length: 64 })
    credentialFingerprint: string;

    @Column({ type: 'varchar', length: 64, default: '' })
    credentialCodeSnapshot: string;

    @Column({ type: 'varchar', length: 120, default: '' })
    credentialNameSnapshot: string;

    @Column({ type: 'varchar', length: 8, default: '' })
    credentialLast4Snapshot: string;

    @Column({ type: 'varchar', length: 160, nullable: true })
    credentialSelectionReason: string | null;

    @Column('int')
    saleUnitPriceSnapshot: number;

    @Column({ type: 'varchar', length: 3 })
    saleCurrencyCode: string;

    @Column({ type: 'varchar', length: 24 })
    outcome: string;

    @Column('int', { nullable: true })
    httpStatus: number | null;

    @Column({ type: 'varchar', length: 200, nullable: true })
    providerRequestId: string | null;

    @Column('int')
    latencyMs: number;

    @Column('int', { nullable: true })
    actualCostMicrounits: number | null;

    @Column({ type: 'varchar', length: 3, nullable: true })
    costCurrency: string | null;

    @Column({ type: 'simple-json', nullable: true })
    usage: Record<string, any> | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;
}
