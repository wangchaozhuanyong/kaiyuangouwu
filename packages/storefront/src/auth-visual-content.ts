import type { StorefrontContentBlock } from './types';

export type AuthVisualVariant = 'login' | 'register';

/** Lightweight content lookup shared by media hints and the deferred authentication UI. */
export function findAuthVisualContent(
    blocks: StorefrontContentBlock[],
    variant: AuthVisualVariant,
): StorefrontContentBlock | undefined {
    const type = variant === 'register' ? 'AUTH_REGISTER' : 'AUTH_LOGIN';
    return blocks.find(block => block.type === type);
}
