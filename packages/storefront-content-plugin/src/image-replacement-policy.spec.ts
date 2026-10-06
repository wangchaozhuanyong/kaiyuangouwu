import { describe, expect, it } from 'vitest';

import { imageReplacements, sourceImageReplacements } from './image-replacement-policy';

describe('merchant image ownership', () => {
    const previous = {
        imageAssetId: 'hero',
        imageUrl: '/assets/hero.png',
        items: [
            { id: 'a', imageAssetId: 'photo-a' },
            { id: 'b', imageUrl: '/assets/b.png' },
        ],
    };
    it('preserves omitted media fields and item identity across reordering', () => {
        expect(imageReplacements(previous, {})).toEqual([]);
        expect(imageReplacements(previous, { items: [{ id: 'b' }, { id: 'a' }] })).toEqual([]);
        expect(imageReplacements(previous, { imageAssetId: 'hero', imageUrl: null })).toEqual([]);
    });
    it('detects replacing, clearing and deleting existing photos', () => {
        expect(imageReplacements(previous, { imageAssetId: 'new' })).toMatchObject([
            { slot: 'main', after: 'asset:new' },
        ]);
        expect(imageReplacements(previous, { imageAssetId: null })).toMatchObject([
            { slot: 'main', after: null },
        ]);
        expect(imageReplacements(previous, { items: [{ id: 'b', imageUrl: null }] })).toHaveLength(2);
        expect(
            imageReplacements(previous, { items: [{ imageAssetId: 'photo-a' }, { id: 'b' }] }),
        ).toMatchObject([{ slot: 'item:a' }]);
    });
    it('allows adding an image to an empty slot', () => {
        expect(
            imageReplacements(
                { items: [{ id: 'empty' }] },
                { imageAssetId: 'first', items: [{ id: 'empty', imageAssetId: 'added' }] },
            ),
        ).toEqual([]);
    });
    it('allows adding the first mobile hero image without authorizing a desktop replacement', () => {
        expect(
            imageReplacements(previous, {
                settings: { mobileImageAssetId: 'first-mobile', mobileImageUrl: '/assets/mobile.webp' },
            }),
        ).toEqual([]);
        expect(
            imageReplacements(previous, {
                imageAssetId: 'new-desktop',
                settings: { mobileImageAssetId: 'first-mobile' },
            }),
        ).toEqual([{ slot: 'main', before: 'asset:hero', after: 'asset:new-desktop' }]);
    });
    it('preserves mobile hero ownership across copy, color and metadata edits', () => {
        const withMobile = {
            ...previous,
            settings: {
                mobileImageAssetId: 'mobile',
                mobileImageUrl: '/assets/mobile.webp',
                mobileImageWidth: 1098,
                mobileImageHeight: 840,
            },
        };
        expect(
            imageReplacements(withMobile, {
                settings: {
                    ...withMobile.settings,
                    title: '新文案',
                    accentColor: '#292d32',
                    mobileImageWidth: 2196,
                },
            }),
        ).toEqual([]);
        expect(imageReplacements(withMobile, {})).toEqual([]);
    });
    it('reviews replacement, explicit clearing and omitted mobile bindings in replaced settings', () => {
        const withMobile = {
            ...previous,
            settings: { mobileImageAssetId: 'mobile', mobileImageUrl: '/assets/mobile.webp' },
        };
        expect(imageReplacements(withMobile, { settings: { mobileImageAssetId: 'new-mobile' } })).toEqual([
            { slot: 'mobile-hero', before: 'asset:mobile', after: 'asset:new-mobile' },
        ]);
        for (const settings of [
            null,
            {},
            { accentColor: '#292d32' },
            { mobileImageAssetId: null, mobileImageUrl: null },
        ]) {
            expect(imageReplacements(withMobile, { settings })).toEqual([
                { slot: 'mobile-hero', before: 'asset:mobile', after: null },
            ]);
        }
    });
    it('also protects a mobile hero image bound only by its URL', () => {
        const withMobile = { ...previous, settings: { mobileImageUrl: '/assets/mobile.webp' } };
        expect(
            imageReplacements(withMobile, { settings: { mobileImageUrl: '/assets/new-mobile.webp' } }),
        ).toEqual([{ slot: 'mobile-hero', before: '/assets/mobile.webp', after: '/assets/new-mobile.webp' }]);
        expect(imageReplacements(withMobile, { settings: {} })).toEqual([
            { slot: 'mobile-hero', before: '/assets/mobile.webp', after: null },
        ]);
    });
});

describe('promotion source image ownership', () => {
    const previous = [
        '<img src="/a.png"><img src="/a.png">',
        '<video poster="/poster.png"></video>',
        '<div style="background:url(/bg.png)"></div>',
        '<img srcset="/small.png 1x, /large.png 2x">',
    ].join('');
    it('allows copy, color and markup changes while preserving every placement', () => {
        expect(sourceImageReplacements(previous, `<h1>new copy</h1>${previous}`)).toEqual([]);
        expect(
            sourceImageReplacements(
                '<img src="/a.png"><img src="/b.png">',
                '<img src="/b.png"><img src="/a.png">',
            ),
        ).toEqual([]);
    });
    it('protects duplicate placements, backgrounds, posters and responsive images', () => {
        const changes = sourceImageReplacements(previous, '<img src="/a.png"><img src="/new.png">');
        expect(changes.map(change => change.before)).toEqual([
            '/a.png',
            '/poster.png',
            '/small.png',
            '/large.png',
            '/bg.png',
        ]);
        expect(changes[0].after).toBe('/new.png');
    });
    it('protects Markdown images and ignores commented-out markup', () => {
        expect(sourceImageReplacements('![old](/photo.png "title")', 'new copy')).toMatchObject([
            { before: '/photo.png' },
        ]);
        expect(sourceImageReplacements('<!-- <img src="/old.png"> -->', '')).toEqual([]);
    });
    it('also protects social preview images in meta tags', () => {
        expect(
            sourceImageReplacements(
                '<meta property="og:image" content="/share.png">',
                '<meta property="og:image" content="/new.png">',
            ),
        ).toMatchObject([{ before: '/share.png' }]);
    });
});

it('preserves decoration bindings for copy edits and reviews replacement or clearing', () => {
    const previous = {
        settings: { mobileDecorationImageAssetId: 'skyline', mobileDecorationImageUrl: '/skyline.webp' },
    };
    expect(
        imageReplacements(previous, { settings: { ...previous.settings, formTitleZh: '登录账户' } }),
    ).toEqual([]);
    expect(imageReplacements(previous, { settings: {} })).toMatchObject([
        { slot: 'mobile-decoration', before: 'asset:skyline', after: null },
    ]);
    expect(imageReplacements(previous, { settings: { mobileDecorationImageAssetId: 'new' } })).toMatchObject([
        { slot: 'mobile-decoration', after: 'asset:new' },
    ]);
});
