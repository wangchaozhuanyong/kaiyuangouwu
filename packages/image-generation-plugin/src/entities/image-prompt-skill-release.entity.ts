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

    get supportedUseCases(): string[] {
        return bundleItems(this.bundle, 'useCases')
            .map(item => stringValue(item, 'code'))
            .filter((value): value is string => Boolean(value));
    }

    get supportedModels(): string[] {
        return bundleItems(this.bundle, 'models')
            .map(
                item =>
                    stringValue(item, 'displayNameZh') ??
                    stringValue(item, 'displayNameEn') ??
                    stringValue(item, 'code'),
            )
            .filter((value): value is string => Boolean(value));
    }

    get routingStrategy(): string {
        const routing = this.bundle?.routing;
        if (!routing || typeof routing !== 'object' || Array.isArray(routing)) return 'UNKNOWN';
        return stringValue(routing as Record<string, unknown>, 'defaultStrategy') ?? 'UNKNOWN';
    }
}

function bundleItems(bundle: Record<string, any> | undefined, key: string): Array<Record<string, unknown>> {
    const value = bundle?.[key];
    return Array.isArray(value)
        ? value.filter(
              (item): item is Record<string, unknown> =>
                  Boolean(item) && typeof item === 'object' && !Array.isArray(item),
          )
        : [];
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
