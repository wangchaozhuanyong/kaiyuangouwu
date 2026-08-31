import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_provider_credential' })
@Index('IDX_image_provider_credential_code', ['code'], { unique: true })
@Index('IDX_image_provider_credential_route', ['scope', 'enabled', 'priority'])
export class ImageProviderCredential extends VendureEntity {
    constructor(input?: DeepPartial<ImageProviderCredential>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24, default: 'GLOBAL' })
    scope: string;

    @Column({ type: 'varchar', length: 64 })
    code: string;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 24, default: 'BOTH' })
    purpose: string;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column({ type: 'varchar', length: 500 })
    baseUrl: string;

    @Column({ type: 'text' })
    encryptedApiKey: string;

    @Column({ type: 'varchar', length: 8, default: '' })
    apiKeyLast4: string;

    @Column({ type: 'varchar', length: 160, default: '' })
    textModelId: string;

    @Column({ type: 'varchar', length: 160, default: '' })
    orchestrationModelId: string;

    @Column({ type: Date, nullable: true })
    lastTestedAt: Date | null;

    @Column({ type: 'varchar', length: 24, default: 'UNTESTED' })
    healthStatus: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    healthMessage: string | null;

    @Column('int', { default: 100 })
    priority: number;

    @Column('int', { default: 1 })
    weight: number;

    @Column('int', { default: 0 })
    currentWeight: number;

    @Column('int', { default: 0 })
    consecutiveFailures: number;

    @Column({ type: Date, nullable: true })
    cooldownUntil: Date | null;

    @Column({ type: Date, nullable: true })
    lastUsedAt: Date | null;

    @Column({ type: Date, nullable: true })
    archivedAt: Date | null;
}
