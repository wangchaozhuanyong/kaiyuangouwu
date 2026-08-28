import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { HomeDualCategoryShowcase } from './App';
import { StorefrontContentBlock } from './types';

function blockFixture(settings: Record<string, unknown> | null = { dualCardTemplate: 'forest-amber' }) {
    return {
        id: 'core-categories-1',
        code: 'homepage-core-categories',
        type: 'CORE_CATEGORIES',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings,
        title: '核心品类精选',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items: [
            {
                id: 'card-1',
                enabled: true,
                position: 0,
                imageUrl: null,
                targetType: 'PAGE',
                targetValue: 'category',
                settings: { badgeLabelZh: '桌面数码', ctaLabelZh: '探索硬件' },
                label: '后台设置的办公卡片',
                description: '后台设置的办公说明',
            },
            {
                id: 'card-2',
                enabled: true,
                position: 1,
                imageUrl: null,
                targetType: 'PAGE',
                targetValue: 'category',
                settings: { badgeLabelZh: '数字生产力', ctaLabelZh: '即刻获取' },
                label: '后台设置的数字卡片',
                description: '后台设置的数字说明',
            },
        ],
    } satisfies StorefrontContentBlock;
}

describe('HomeDualCategoryShowcase', () => {
    it('renders managed copy with the selected template', () => {
        const markup = renderToStaticMarkup(
            <HomeDualCategoryShowcase language="zh" block={blockFixture()} onContentTarget={vi.fn()} />,
        );

        expect(markup).toContain('data-card-template="forest-amber"');
        expect(markup).toContain('后台设置的办公卡片');
        expect(markup).toContain('桌面数码');
        expect(markup).toContain('探索硬件');
        expect(markup).not.toContain('极简办公工作站');
    });

    it('uses the screenshot template for missing or invalid settings', () => {
        for (const settings of [null, { dualCardTemplate: 'unknown' }]) {
            const markup = renderToStaticMarkup(
                <HomeDualCategoryShowcase
                    language="zh"
                    block={blockFixture(settings)}
                    onContentTarget={vi.fn()}
                />,
            );

            expect(markup).toContain('data-card-template="tech-duo"');
        }
    });

    it('renders the light tech-duo card roles and decorative icons', () => {
        const markup = renderToStaticMarkup(
            <HomeDualCategoryShowcase
                language="zh"
                block={blockFixture({ dualCardTemplate: 'tech-duo' })}
                onContentTarget={vi.fn()}
            />,
        );

        expect(markup).toContain('showcase-card--gateway');
        expect(markup).toContain('showcase-card--support');
        expect(markup).toContain('lucide-waypoints');
        expect(markup).toContain('lucide-headphones');
        expect(markup.match(/showcase-card-icon/g)).toHaveLength(2);
    });

    it('renders nothing for an empty managed block', () => {
        const markup = renderToStaticMarkup(
            <HomeDualCategoryShowcase
                language="zh"
                block={{ ...blockFixture(), items: [] }}
                onContentTarget={vi.fn()}
            />,
        );

        expect(markup).toBe('');
    });
});
