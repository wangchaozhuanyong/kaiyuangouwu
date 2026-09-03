import type { StorefrontContentBlock } from './types';

type ManagedContentCopyField = 'title' | 'subtitle' | 'body' | 'ctaLabel';

/**
 * Uses bundled copy only when no managed block exists. An empty managed field is
 * an intentional Dashboard value and must remain empty in the storefront.
 */
export function resolveManagedContentCopy(
    block: StorefrontContentBlock | undefined,
    field: ManagedContentCopyField,
    fallback: string,
): string {
    return block ? block[field].trim() : fallback;
}
