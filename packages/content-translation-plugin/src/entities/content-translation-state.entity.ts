import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { ContentTranslationOrigin, ContentTranslationStatus } from '../types.js';

@Entity({ name: 'content_translation_state' })
@Index('IDX_content_translation_state_key', ['stateKey'], { unique: true })
@Index('IDX_content_translation_state_audit', ['channelId', 'entityType', 'status'])
export class ContentTranslationState extends VendureEntity {
    constructor(input?: DeepPartial<ContentTranslationState>) {
        super(input);
    }

    @Column('varchar', { length: 64 })
    stateKey: string;

    @Column('varchar', { length: 64, nullable: true })
    channelId: string | null;

    @Column('varchar', { length: 64 })
    entityType: string;

    @Column('varchar', { length: 64 })
    entityId: string;

    @Column('varchar', { length: 128 })
    fieldPath: string;

    @Column('varchar', { length: 20, default: 'zh_Hans' })
    sourceLanguageCode: string;

    @Column('varchar', { length: 20, default: 'en' })
    targetLanguageCode: string;

    @Column('varchar', { length: 64 })
    sourceHash: string;

    @Column('varchar', { length: 64, nullable: true })
    translatedHash: string | null;

    @Column('varchar', { length: 24, default: 'MISSING' })
    status: ContentTranslationStatus;

    @Column('varchar', { length: 12, default: 'AUTO' })
    origin: ContentTranslationOrigin;

    @Column('boolean', { default: false })
    locked: boolean;

    @Column('text', { nullable: true })
    error: string | null;
}
