import type { CSSProperties } from 'react';
import type { StorefrontContentBlock } from './types';

import { configuredColor } from '../../storefront-content-plugin/src/shared/auth-visual';

export function managedContentStyle(block: StorefrontContentBlock): CSSProperties {
    const foreground = configuredColor(block.textColor);
    return {
        backgroundColor: configuredColor(block.backgroundColor) ?? 'var(--store-background, var(--paper))',
        color: foreground ?? 'var(--store-foreground, var(--text))',
        ...(foreground ? { '--text': foreground, '--muted': foreground } : {}),
        ...(configuredColor(block.settings?.accentColor)
            ? { '--accent': configuredColor(block.settings?.accentColor) }
            : {}),
    };
}
