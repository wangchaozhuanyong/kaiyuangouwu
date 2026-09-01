export type ContentTranslationFormat = 'TEXT' | 'HTML';

export type ContentTranslationStatus =
    | 'MISSING'
    | 'PENDING'
    | 'TRANSLATING'
    | 'AUTO_TRANSLATED'
    | 'REVIEWED'
    | 'MANUAL_LOCKED'
    | 'STALE'
    | 'FAILED';

export type ContentTranslationOrigin = 'AUTO' | 'MANUAL';

export interface ContentTranslationSegment {
    key: string;
    text: string;
    format?: ContentTranslationFormat;
}

export interface ContentTranslationRequest {
    sourceLanguageCode: 'zh_Hans';
    targetLanguageCode: 'en';
    segments: ContentTranslationSegment[];
    glossary?: Record<string, string>;
}

export interface ContentTranslationResult {
    provider: string;
    translations: Array<{ key: string; text: string }>;
}

export interface ContentTranslationProvider {
    readonly name: string;
    isConfigured(): boolean;
    translate(request: ContentTranslationRequest): Promise<ContentTranslationResult>;
}

export interface ContentTranslationPluginOptions {
    provider?: ContentTranslationProvider;
    glossary?: Record<string, string>;
    sourceLanguageCode?: 'zh_Hans';
    targetLanguageCode?: 'en';
}

export interface TranslationStateIdentity {
    channelId?: string | number | null;
    entityType: string;
    entityId: string | number;
    fieldPath: string;
    targetLanguageCode?: 'en';
}

export interface RecordTranslationStateInput extends TranslationStateIdentity {
    sourceText: string;
    translatedText?: string | null;
    status: ContentTranslationStatus;
    origin?: ContentTranslationOrigin;
    error?: string | null;
    locked?: boolean;
}

export interface LocalizedContentFieldInput {
    path: string;
    sourceText: string;
    targetText?: string | null;
    existingSourceText?: string | null;
    existingTargetText?: string | null;
    manualLock?: boolean | null;
    existingLocked?: boolean | null;
    format?: ContentTranslationFormat;
    required?: boolean;
}

export interface PreparedLocalizedContentField {
    path: string;
    sourceText: string;
    translatedText: string;
    status: ContentTranslationStatus;
    origin: ContentTranslationOrigin;
    locked: boolean;
}
