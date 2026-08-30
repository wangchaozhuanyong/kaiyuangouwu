import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_generation_runtime_status' })
@Index('IDX_image_generation_runtime_queue', ['queueName'], { unique: true })
export class ImageGenerationRuntimeStatus extends VendureEntity {
    constructor(input?: DeepPartial<ImageGenerationRuntimeStatus>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 64 })
    queueName: string;

    @Column({ type: 'varchar', length: 96, nullable: true })
    workerId: string | null;

    @Column({ type: 'varchar', length: 24, nullable: true })
    status: string | null;

    @Column({ type: Date, nullable: true })
    heartbeatAt: Date | null;

    @Column({ type: Date, nullable: true })
    lastReconcileAt: Date | null;

    @Column('int', { nullable: true })
    activeJobs: number | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    lastError: string | null;
}
