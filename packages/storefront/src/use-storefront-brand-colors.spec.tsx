// @vitest-environment jsdom
// organize-imports-ignore -- The repository import-order rule places the shared preset type first.
import type { StorefrontVisualPresetId } from '../../storefront-content-plugin/src/visual-presets';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { useStorefrontBrandColors } from './hooks/useStorefrontDocument';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Skin({ presetId }: { presetId: StorefrontVisualPresetId }) {
    useStorefrontBrandColors(undefined, presetId);
    return null;
}

describe('storefront skin surface lifecycle', () => {
    it('switches the palette and surface treatment together, then clears both on unmount', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        act(() => root.render(<Skin presetId="classic" />));
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f1f5f9');
        expect(document.documentElement.style.getPropertyValue('--skin-divider')).toBe('#e4eaf1');

        act(() => root.render(<Skin presetId="neo-minimalist" />));
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#070b14');
        expect(document.documentElement.style.getPropertyValue('--skin-divider')).toBe('#2a3548');

        act(() => root.unmount());
        expect(document.documentElement.style.getPropertyValue('--bg')).toBe('');
        expect(document.documentElement.style.getPropertyValue('--skin-divider')).toBe('');
        host.remove();
    });
});
