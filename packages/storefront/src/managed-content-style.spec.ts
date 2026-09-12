import { describe, expect, it } from 'vitest';

import { managedContentStyle } from './managed-content-style';
import { StorefrontContentBlock } from './types';

function createBlock(overrides: Partial<StorefrontContentBlock> = {}): StorefrontContentBlock {
    return {
        id: 'block-1',
        code: 'block-1',
        type: 'STORY',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        title: 'Story Title',
        subtitle: '',
        body: '',
        imageUrl: null,
        ctaLabel: '',
        targetType: 'NONE',
        targetValue: null,
        backgroundColor: null,
        textColor: null,
        settings: null,
        items: [],
        ...overrides,
    };
}

describe('managedContentStyle', () => {
    it('returns empty style when background and text colors are unset', () => {
        const style = managedContentStyle(createBlock());
        expect(style.backgroundColor).toBeUndefined();
        expect(style.color).toBeUndefined();
    });

    it('applies configured colors when explicitly set', () => {
        const style = managedContentStyle(
            createBlock({
                backgroundColor: '#1a2b3c',
                textColor: '#ffffff',
                settings: { accentColor: '#ff0000' },
            }),
        );
        expect(style.backgroundColor).toBe('#1a2b3c');
        expect(style.color).toBe('#ffffff');
        expect((style as Record<string, unknown>)['--accent']).toBe('#ff0000');
    });
});
