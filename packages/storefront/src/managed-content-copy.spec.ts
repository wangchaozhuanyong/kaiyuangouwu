import { describe, expect, it } from 'vitest';

import { resolveManagedContentCopy } from './managed-content-copy';
import { StorefrontContentBlock } from './types';

function recommendationBlock(subtitle: string): StorefrontContentBlock {
    return {
        id: 'recommendations-1',
        code: 'homepage-recommendations',
        type: 'RECOMMENDATIONS',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        title: '猜你喜欢',
        subtitle,
        body: '',
        ctaLabel: '',
        items: [],
    };
}

describe('resolveManagedContentCopy', () => {
    it('uses bundled copy only when the managed block is absent', () => {
        expect(resolveManagedContentCopy(undefined, 'subtitle', '本地兜底文案')).toBe('本地兜底文案');
    });

    it('preserves an intentionally empty managed field', () => {
        expect(resolveManagedContentCopy(recommendationBlock('   '), 'subtitle', '本地兜底文案')).toBe('');
    });

    it('uses and normalizes the managed value when configured', () => {
        expect(
            resolveManagedContentCopy(
                recommendationBlock('  后台设置的推荐说明  '),
                'subtitle',
                '本地兜底文案',
            ),
        ).toBe('后台设置的推荐说明');
    });
});
