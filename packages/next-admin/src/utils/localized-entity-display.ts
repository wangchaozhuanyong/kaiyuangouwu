import {
    getAdminDisplayLanguage,
    normalizeAdminDisplayLanguage,
    type AdminDisplayLanguage,
} from './admin-language';

export interface EntityTranslation {
    languageCode: string;
    name?: string | null;
    description?: string | null;
}

export interface LocalizedEntity {
    name?: string | null;
    description?: string | null;
    translations?: readonly EntityTranslation[] | null;
}

function translatedField(
    entity: LocalizedEntity,
    field: 'name' | 'description',
    languageCode: AdminDisplayLanguage,
): string {
    const translations = entity.translations ?? [];
    const exact = translations.find(
        translation => normalizeAdminDisplayLanguage(translation.languageCode) === languageCode,
    );
    const value = exact?.[field]?.trim();
    if (value) return value;

    // Legacy records and lightweight queries can omit the translations array. In that case the
    // API-level `languageCode` is the source of truth and the resolved field is safe to display.
    if (translations.length === 0) return entity[field]?.trim() ?? '';

    // Never silently borrow the other language when translations were explicitly returned.
    return '';
}

export function getLocalizedEntityName(
    entity: LocalizedEntity,
    languageCode = getAdminDisplayLanguage(),
): string {
    return (
        translatedField(entity, 'name', languageCode) ||
        (languageCode === 'zh_Hans' ? '未填写中文名称' : 'English name not set')
    );
}

export function getLocalizedEntityDescription(
    entity: LocalizedEntity,
    languageCode = getAdminDisplayLanguage(),
): string {
    return translatedField(entity, 'description', languageCode);
}

export function getLocalizedEntityTranslation<T extends EntityTranslation>(
    translations: readonly T[] | null | undefined,
    languageCode = getAdminDisplayLanguage(),
): T | undefined {
    return translations?.find(
        translation => normalizeAdminDisplayLanguage(translation.languageCode) === languageCode,
    );
}
