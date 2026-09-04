import type { StorefrontContentBlock } from '../../graphql/storefront.graphql';

export function businessServicesLinkValue(block: StorefrontContentBlock): string {
    return block.targetType === 'URL' ? (block.targetValue ?? '') : '';
}

export function businessServicesLinkIsValid(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return true;
    if (normalized.startsWith('#/')) return true;
    if (normalized.startsWith('/') && !normalized.startsWith('//')) return true;
    try {
        const url = new URL(normalized);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function updateBusinessServicesLink(
    block: StorefrontContentBlock,
    value: string,
): StorefrontContentBlock {
    const hasValue = Boolean(value.trim());
    return {
        ...block,
        targetType: hasValue ? 'URL' : 'NONE',
        targetValue: hasValue ? value : null,
    };
}
