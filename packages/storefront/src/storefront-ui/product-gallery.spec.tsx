// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Product } from '../types';

import { ProductGallery } from './product-gallery';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cover = { id: 'cover', preview: '/assets/preview/cover.png' };
const detail = { id: 'detail', preview: '/assets/preview/detail.png' };
const product: Product = {
    id: 'product-1',
    name: 'Product one',
    slug: 'product-one',
    createdAt: '2026-09-05T00:00:00.000Z',
    description: '',
    featuredAsset: cover,
    assets: [detail, cover],
    variants: [],
    collections: [],
};

describe('ProductGallery interactions', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(value: Product) {
        act(() => root.render(<ProductGallery product={value} language="zh" />));
    }

    function selectSecondImage() {
        const button = container.querySelector<HTMLButtonElement>('[aria-label="查看第2张商品图"]');
        expect(button).not.toBeNull();
        act(() => button?.click());
    }

    function expectImage(source: string, index: number) {
        expect(container.querySelector('img')?.getAttribute('src')).toContain(source);
        expect(container.querySelector('.gallery-count')?.textContent).toMatch(new RegExp(`^${index} /`));
    }

    it('selects other images with matching placeholders and keeps selection on unchanged data refetches', () => {
        render(product);
        expectImage(cover.preview, 1);
        selectSecondImage();
        expectImage(detail.preview, 2);
        expect(container.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe(
            '查看第2张商品图',
        );
        expect(container.querySelector<HTMLElement>('.safe-image-frame')?.style.backgroundImage).toContain(
            detail.preview,
        );

        render({ ...product, assets: product.assets.map(asset => ({ ...asset })), name: 'Updated name' });
        expectImage(detail.preview, 2);
        expect(container.querySelector('img')?.alt).toBe('Updated name 2');
    });

    it('starts a different product on its cover even when both products share the same gallery', () => {
        render(product);
        selectSecondImage();
        render({ ...product, id: 'product-2', name: 'Product two' });
        expectImage(cover.preview, 1);
        expect(container.querySelector('img')?.alt).toBe('Product two 1');
    });

    it('shows a newly selected cover immediately without reordering the stored gallery', () => {
        render(product);
        selectSecondImage();
        const replacement = { id: 'replacement', preview: '/assets/preview/new-cover.png' };
        render({ ...product, featuredAsset: replacement });
        expectImage(replacement.preview, 1);
        expect(container.querySelectorAll('.gallery-dots button')).toHaveLength(3);
    });

    it('returns to the cover when the selected image is removed instead of leaving an invalid index', () => {
        render(product);
        selectSecondImage();
        render({ ...product, assets: [cover] });
        expectImage(cover.preview, 1);
        expect(container.querySelector('.gallery-dots')).toBeNull();
    });

    it('refreshes the image and placeholder when an asset keeps its ID but changes preview', () => {
        render(product);
        selectSecondImage();
        const updatedCover = { ...cover, preview: '/assets/preview/updated-cover.png' };
        render({ ...product, featuredAsset: updatedCover });
        expectImage(updatedCover.preview, 1);
        expect(container.querySelector<HTMLElement>('.safe-image-frame')?.style.backgroundImage).toContain(
            updatedCover.preview,
        );
    });

    it('handles removing all media and later adding a separately managed cover', () => {
        render(product);
        selectSecondImage();
        render({ ...product, featuredAsset: null, assets: [] });
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.image-placeholder')).not.toBeNull();
        expect(container.querySelector('.gallery-count')).toBeNull();

        render({ ...product, assets: [] });
        expectImage(cover.preview, 1);
    });
});
