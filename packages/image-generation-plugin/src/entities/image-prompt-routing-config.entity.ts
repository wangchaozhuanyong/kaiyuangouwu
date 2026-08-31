import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_prompt_routing_config' })
@Index('IDX_image_prompt_routing_config_singleton', ['singletonKey'], { unique: true })
export class ImagePromptRoutingConfig extends VendureEntity {
    constructor(input?: DeepPartial<ImagePromptRoutingConfig>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16, default: 'GLOBAL' })
    singletonKey: string;

    @Column({ type: 'varchar', length: 16, default: 'AUTO' })
    strategy: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    primaryCredentialCode: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    primaryModelId: string | null;

    @Column('boolean', { default: false })
    fallbackEnabled: boolean;

    @Column({ type: 'varchar', length: 64, nullable: true })
    fallbackCredentialCode: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    fallbackModelId: string | null;
}
