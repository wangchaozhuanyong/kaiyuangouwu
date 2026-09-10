import { type CSSProperties } from 'react';

import { configuredColor } from '../../storefront-content-plugin/src/shared/auth-visual';

import { type StorefrontContentBlock } from './types';

export function managedContentStyle(block: StorefrontContentBlock): CSSProperties {
    const background = configuredColor(block.backgroundColor);
    const foreground = configuredColor(block.textColor);
    const accent = configuredColor(block.settings?.accentColor);
    return {
        ...(background ? { backgroundColor: background } : {}),
        ...(foreground ? { color: foreground, '--text': foreground, '--muted': foreground } : {}),
        ...(accent ? { '--accent': accent } : {}),
    };
}
