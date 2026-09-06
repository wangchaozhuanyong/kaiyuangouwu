import { describe, expect, it } from 'vitest';

import { normalizeStorefrontVisualPreset } from '../../storefront-content-plugin/src/visual-presets';

import { storefrontRealtimeQueryMatches, type StorefrontRealtimeEvent } from './realtime-updates';
import { applyStorefrontVisualPreset } from './use-storefront-visual-preset';

describe('storefront visual preset lifecycle', () => {
    it('removes the previous skin when switching back to classic or unmounting', () => {
        const root = { dataset: {} } as HTMLElement;
        const dispose = applyStorefrontVisualPreset(root, 'modern-oriental');
        expect(root.dataset.storefrontPreset).toBe('modern-oriental');
        dispose();
        expect(root.dataset.storefrontPreset).toBeUndefined();
        applyStorefrontVisualPreset(root, 'classic');
        expect(root.dataset.storefrontPreset).toBe('classic');
        expect(normalizeStorefrontVisualPreset('invalid')).toBe('classic');
    });

    it('invalidates only the active store skin after a content event', () => {
        const event: StorefrontRealtimeEvent = {
            version: 1,
            id: '1',
            occurredAt: new Date().toISOString(),
            topics: ['content'],
        };
        const scope = { marketCode: 'a:MYR', languageCode: 'zh_Hans' };
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: ['storefront', 'a:MYR', 'zh_Hans', 'visual-preset'] },
                event,
                scope,
            ),
        ).toBe(true);
        expect(
            storefrontRealtimeQueryMatches(
                { queryKey: ['storefront', 'b:CNY', 'zh_Hans', 'visual-preset'] },
                event,
                scope,
            ),
        ).toBe(false);
    });
});
