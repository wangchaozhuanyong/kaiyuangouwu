// organize-imports-ignore -- Preserve ESLint type groups.
import type { Product, ReferralPosterTemplate, ReferralProgram } from './types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DEFAULT_ARTWORK_POSTER_DESIGN } from '../../common/src/referral-poster-design';

import { SharePosterSurface } from './components/common/share-poster-surface';
import { createCircularQrSvgDataUrl } from './poster-qr';
import { productPosterQrStyle } from './share-poster-modal';

describe('share poster QR code', () => {
    it('creates a local circular SVG data URL without a network image request', () => {
        const dataUrl = createCircularQrSvgDataUrl('https://example.test/#/product/1', 'minimal', 480);
        const svg = decodeURIComponent(dataUrl.split(',', 2)[1]);

        expect(dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
        expect(svg).toContain('<svg');
        expect(svg).toContain('width="480"');
        expect(svg).toContain('<circle');
        expect(svg).not.toContain('<image');
    });

    it('inherits only the enabled default template style, independently of customer rewards', () => {
        const template = {
            id: 'merchant-artwork',
            enabled: true,
            design: {
                ...DEFAULT_ARTWORK_POSTER_DESIGN,
                qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, style: 'jade' },
            },
        } as ReferralPosterTemplate;
        const program = {
            enabled: false,
            defaultPosterTemplate: template.id,
            posterTemplates: [],
            posterTemplateConfigs: [template],
        } as unknown as ReferralProgram;
        expect(productPosterQrStyle(program)).toBe('jade');
        expect(productPosterQrStyle({ ...program, defaultPosterTemplate: 'missing' })).toBe('minimal');
        expect(
            productPosterQrStyle({ ...program, posterTemplateConfigs: [{ ...template, enabled: false }] }),
        ).toBe('minimal');
        expect(
            productPosterQrStyle({ ...program, posterTemplateConfigs: [{ ...template, design: null }] }),
        ).toBe('minimal');
        expect(productPosterQrStyle(undefined)).toBe('minimal');
        expect(
            productPosterQrStyle({
                ...program,
                posterTemplateConfigs: [],
                systemPosterTemplateConfigs: [template],
                posterTemplates: [template.id],
            }),
        ).toBe('jade');
        expect(
            productPosterQrStyle({
                ...program,
                posterTemplateConfigs: [],
                systemPosterTemplateConfigs: [template],
            }),
        ).toBe('minimal');
    });
});

describe('shared poster waiting surface', () => {
    const product = {
        id: 'local',
        name: '本地商品',
        featuredAsset: null,
        assets: [],
        variants: [],
    } as unknown as Product;
    it('shows known content and reserves the QR slot before the export module arrives', () => {
        const pending = renderToStaticMarkup(
            SharePosterSurface({
                product,
                storefrontName: '本地合成数据',
                logoUrl: null,
                language: 'zh',
                formattedPrice: '¥10',
                pending: true,
            }),
        );
        const ready = renderToStaticMarkup(
            SharePosterSurface({
                product,
                storefrontName: '本地合成数据',
                logoUrl: null,
                language: 'zh',
                formattedPrice: '¥10',
                qrCodeUrl: 'data:image/svg+xml,<svg></svg>',
                qrReady: true,
            }),
        );
        for (const html of [pending, ready]) {
            expect(html).toContain('poster-preview-wrapper');
            expect(html).toContain('poster-image-box');
            expect(html).toContain('poster-actions-row');
            expect(html).toContain('class="poster-qrcode"');
            expect(html).toContain('本地商品');
        }
        expect(pending.match(/disabled=""/g)).toHaveLength(2);
        expect(ready).not.toContain('disabled=""');
        expect(pending).toContain('role="status"');
    });

    it('keeps saving disabled until the QR image loads and exposes a retry on failure', () => {
        const props = {
            product,
            storefrontName: '本地合成数据',
            logoUrl: null,
            language: 'zh' as const,
            formattedPrice: '¥10',
            qrCodeUrl: 'data:image/svg+xml,<svg></svg>',
        };
        const loading = renderToStaticMarkup(SharePosterSurface(props));
        expect(loading.match(/disabled=""/g)).toHaveLength(1);
        expect(loading).toContain('正在准备二维码');
        const failure = renderToStaticMarkup(
            SharePosterSurface({ ...props, qrError: '二维码生成失败', onQrRetry: () => undefined }),
        );
        expect(failure.match(/disabled=""/g)).toHaveLength(1);
        expect(failure).toContain('role="alert"');
        expect(failure).toContain('重试');
    });
});
