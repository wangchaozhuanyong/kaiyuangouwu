import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_prompt_skill_release' })
@Index('IDX_image_prompt_skill_hash', ['sourceHash'], { unique: true })
export class ImagePromptSkillRelease extends VendureEntity {
    constructor(input?: DeepPartial<ImagePromptSkillRelease>) {
        super(input);
    }

    @Column('int')
    bundleVersion: number;

    @Column({ type: 'varchar', length: 64 })
    sourceHash: string;

    @Column({ type: 'varchar', length: 24, default: 'INACTIVE' })
    status: string;

    @Column({ type: 'simple-json' })
    bundle: Record<string, any>;

    @Column({ type: Date, nullable: true })
    activatedAt: Date | null;
}
