import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Channel, Customer, EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@Entity({ name: 'image_prompt_optimization' })
@Index('IDX_image_prompt_optimization_customer_created', ['channelId', 'customerId', 'createdAt'])
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
}
