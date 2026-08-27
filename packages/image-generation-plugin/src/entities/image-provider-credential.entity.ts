import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'image_provider_credential' })
@Index('IDX_image_provider_credential_scope', ['scope'], { unique: true })
export class ImageProviderCredential extends VendureEntity {
    constructor(input?: DeepPartial<ImageProviderCredential>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 24, default: 'GLOBAL' })
    scope: string;

    @Column('boolean', { default: false })
    enabled: boolean;

    @Column({ type: 'varchar', length: 500 })
    baseUrl: string;

    @Column({ type: 'text' })
    encryptedApiKey: string;

    @Column({ type: 'varchar', length: 8, default: '' })
    apiKeyLast4: string;

    @Column({ type: 'varchar', length: 160 })
    textModelId: string;

    @Column({ type: Date, nullable: true })
    lastTestedAt: Date | null;

    @Column({ type: 'varchar', length: 24, default: 'UNTESTED' })
    healthStatus: string;

    @Column({ type: 'varchar', length: 500, nullable: true })
    healthMessage: string | null;
}
