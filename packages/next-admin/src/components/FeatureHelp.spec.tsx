import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FeatureHelpButton, FeatureHelpProvider } from './FeatureHelp';
import { featureHelpContent, featureHelpCopyText } from './feature-help-content';
import { calculateFeatureHelpPosition } from './feature-help-position';

describe('FeatureHelp', () => {
    it('renders an accessible, visible explanation button beside a title', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <h2>
                    SKU 动态扩展字段
                    <FeatureHelpButton topic="catalog.sku-custom-fields" title="SKU 动态扩展字段" />
                </h2>
            </FeatureHelpProvider>,
        );

        expect(html).toContain('说明</button>');
        expect(html).toContain('aria-label="查看“SKU 动态扩展字段”功能说明"');
        expect(html).toContain('aria-haspopup="dialog"');
    });

    it('keeps every registered explanation complete and copyable', () => {
        expect(Object.keys(featureHelpContent).length).toBeGreaterThanOrEqual(50);

        for (const [topic, content] of Object.entries(featureHelpContent)) {
            expect(content.purpose, topic).not.toHaveLength(0);
            expect(content.requirements.length, topic).toBeGreaterThan(0);
            expect(content.example, topic).not.toHaveLength(0);

            const copy = featureHelpCopyText(topic, content);
            expect(copy).toContain('这个功能做什么');
            expect(copy).toContain('使用要求');
            expect(copy).toContain('举例');
            expect(copy).toContain(content.purpose);
        }
    });

    it('places the card below when space is available and above near the viewport bottom', () => {
        expect(
            calculateFeatureHelpPosition(
                { left: 100, top: 40, bottom: 64 },
                { width: 1200, height: 800 },
                { width: 384, height: 300 },
            ),
        ).toEqual({ left: 100, top: 72, placement: 'below' });

        expect(
            calculateFeatureHelpPosition(
                { left: 1100, top: 700, bottom: 724 },
                { width: 1200, height: 800 },
                { width: 384, height: 300 },
            ),
        ).toEqual({ left: 804, top: 392, placement: 'above' });
    });
});
