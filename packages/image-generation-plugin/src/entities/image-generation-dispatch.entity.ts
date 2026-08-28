import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { EntityId, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { ImageGenerationOutput } from './image-generation-output.entity';

@Entity({ name: 'image_generation_dispatch' })
@Index('IDX_image_generation_dispatch_output', ['outputId'], { unique: true })
@Index('IDX_image_generation_dispatch_state_next', ['state', 'nextAttemptAt'])
export class ImageGenerationDispatch extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationDispatch>) {
        super(input);
    }

    @OneToOne(() => ImageGenerationOutput, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'outputId', foreignKeyConstraintName: 'FK_image_generation_dispatch_output' })
    output: ImageGenerationOutput;

    @EntityId()
    outputId: ID;

    @Column({ type: 'varchar', length: 24, default: 'PENDING' })
    state: string;

    @Column('int', { default: 0 })
    attemptCount: number;

    @Column({ type: Date })
    nextAttemptAt: Date;

    @Column({ type: Date, nullable: true })
    dispatchedAt: Date | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastError: string | null;
}
