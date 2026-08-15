import { Product } from './types';

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

function normalizeSearchText(value: string): string {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

export function hasHanCharacters(value: string): boolean {
    return HAN_CHARACTER_PATTERN.test(value);
}

export function filterProductsByHanTerm(products: Product[], term: string): Product[] {
    const normalizedTerm = normalizeSearchText(term.trim());
    if (!normalizedTerm) return [];

    return products.filter(product => {
        const searchableText = normalizeSearchText(
            [
                product.name,
                product.description,
                ...product.collections.map(collection => collection.name),
                ...product.variants.flatMap(variant => [variant.name, variant.sku]),
            ].join(' '),
        );
        return searchableText.includes(normalizedTerm);
    });
}
