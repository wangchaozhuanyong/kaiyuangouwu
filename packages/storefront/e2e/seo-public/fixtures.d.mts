import type { PublicPageData } from '../../src/storefront-page-data';

export const fixtureStores: string[];
export const fixtureLanguages: Array<'zh_Hans' | 'en'>;
export const fixtureKinds: Array<'home' | 'product' | 'catalog' | 'article'>;
export function syntheticPage(
    store: string,
    languageCode: 'zh_Hans' | 'en',
    kind: 'home' | 'product' | 'catalog' | 'article',
    options?: { host?: string; origin?: string; generatedAt?: number },
): PublicPageData;
