import type { StorefrontContentBlock } from './types';

import { primaryAuthVisualContent } from '../../storefront-content-plugin/src/shared/auth-visual-utils';

export type AuthVisualVariant = 'login' | 'register';

/** Lightweight content lookup shared by media hints and the deferred authentication UI. */
export function findAuthVisualContent(
    blocks: StorefrontContentBlock[],
    variant: AuthVisualVariant,
): StorefrontContentBlock | undefined {
    return primaryAuthVisualContent(blocks, variant);
}
