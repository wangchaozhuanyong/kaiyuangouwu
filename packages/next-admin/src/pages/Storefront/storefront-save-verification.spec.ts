import { describe, expect, it } from 'vitest';
import type {
    StorefrontContentResult,
    StorefrontPromotionRecord,
    SystemAnnouncementRecord,
} from '../../graphql/storefront.graphql';
import { cloneContentBlock, newContentBlock, storefrontBlockInput } from './storefront-content-utils';
import {
    verifyAnnouncement,
    verifyContentChannel,
    verifyContentOrder,
    verifyPromotion,
    verifySavedBlock,
} from './storefront-save-verification';

const block = { ...newContentBlock('SUPPORT', 0), id: 'saved-block' };
const input = storefrontBlockInput(block);

describe('content save and readback verification', () => {
    it('rejects empty responses, missing rows and a different record', () => {
        expect(() => verifySavedBlock(undefined, input)).toThrow('未返回');
        expect(() => verifySavedBlock({ ...block, id: 'other' }, { ...input, id: block.id })).toThrow(
            '未返回',
        );
    });
    it('rejects stale enabled state, altered content and missing cards', () => {
        expect(() => verifySavedBlock({ ...block, enabled: !block.enabled }, input)).toThrow('enabled');
        const altered = cloneContentBlock(block);
        altered.translations[0].title = '其他标题';
        expect(() => verifySavedBlock(altered, input)).toThrow('文案');
        expect(() => verifySavedBlock({ ...block, items: [] }, input)).toThrow('数量');
    });
    it('checks card toggles, targets, copy, position and settings', () => {
        for (const change of [
            { enabled: !block.items[0].enabled },
            { targetType: 'URL', targetValue: 'https://other.example.test' },
            { position: 99 },
            { settings: { altered: true } },
        ]) {
            const altered = cloneContentBlock(block);
            Object.assign(altered.items[0], change);
            expect(() => verifySavedBlock(altered, input)).toThrow('卡片');
        }
    });
    it('allows generated English, reordered JSON keys, normalized dates and managed image URLs', () => {
        const request = {
            ...input,
            translations: [input.translations[0]],
            imageAssetId: 'hero-image',
            imageUrl: null,
            startsAt: '2026-09-26T00:00:00Z',
            settings: { a: 1, b: 2 },
        };
        const saved = cloneContentBlock(block);
        saved.translations[1].title = 'Server translated title';
        saved.startsAt = '2026-09-26T00:00:00.000Z';
        saved.settings = { b: 2, a: 1 };
        saved.imageAssetId = 'hero-image';
        saved.imageUrl = '/assets/preview/hero.png';
        expect(verifySavedBlock(saved, request)).toBe(saved);
    });
    it('accepts imported external images and verifies only explicitly edited English fields', () => {
        const request = { ...input, imageAssetId: null, imageUrl: 'https://images.example.test/cover.jpg' };
        const saved = cloneContentBlock(block);
        saved.imageAssetId = 'imported-image';
        saved.imageUrl = '/assets/imported-image.png';
        request.translations[1] = { ...request.translations[1], updatedFields: ['title'] };
        saved.translations[1].body = 'Generated body';
        expect(verifySavedBlock(saved, request)).toBe(saved);
    });
    it('rejects cross-store readback and mismatched ordering', () => {
        const data = { activeChannel: { id: 'moyao' } } as StorefrontContentResult;
        expect(() => verifyContentChannel(data, 'damatong')).toThrow('店铺');
        expect(() => verifyContentChannel(undefined, 'damatong')).toThrow('店铺');
        expect(() => verifyContentOrder(undefined, ['1'])).toThrow('顺序');
        expect(() =>
            verifyContentOrder(
                [
                    { id: '1', position: 1 },
                    { id: '2', position: 0 },
                ],
                ['1', '2'],
            ),
        ).toThrow('顺序');
        expect(() =>
            verifyContentOrder(
                [
                    { id: '1', position: 0 },
                    { id: '2', position: 1 },
                ],
                ['1', '2'],
            ),
        ).not.toThrow();
    });
});

it('checks announcement copy, enable state and explicit target store scope', () => {
    const expected = {
        id: 'notice',
        enabled: true,
        titleZh: '公告',
        contentZh: '内容',
        priority: 0,
        targetMode: 'SINGLE' as const,
        channelIds: ['damatong'],
        linkUrl: null,
        startsAt: null,
        endsAt: null,
    };
    const saved = {
        ...expected,
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
        titleEn: '',
        contentEn: '',
        titleEnLocked: false,
        contentEnLocked: false,
        channels: [{ id: 'damatong', code: 'damatong' }],
    } as SystemAnnouncementRecord;
    expect(() => verifyAnnouncement(saved, expected)).not.toThrow();
    for (const altered of [
        { ...saved, enabled: false },
        { ...saved, titleZh: '旧标题' },
        { ...saved, channels: [{ id: 'moyao', code: 'moyao' }] },
    ]) {
        expect(() => verifyAnnouncement(altered, expected)).toThrow('不一致');
    }
});
it('rejects missing promotion results and a stale draft or publication version', () => {
    const saved: StorefrontPromotionRecord = {
        id: 'page',
        contentType: 'HTML',
        draftSource: '<h1>New</h1>',
        publishedSource: '<h1>New</h1>',
        isCustomized: true,
        defaultTemplateVersion: 1,
        publishedVersion: 2,
        publishedAt: null,
        publicUrl: '/promotion',
    };
    expect(() => verifyPromotion(saved, saved)).not.toThrow();
    expect(() => verifyPromotion(saved, undefined)).toThrow('不一致');
    expect(() => verifyPromotion({ ...saved, draftSource: 'Old' }, saved)).toThrow('不一致');
    expect(() => verifyPromotion({ ...saved, publishedVersion: 1 }, saved)).toThrow('不一致');
});

it('pins imported image assets to the mutation result during readback', () => {
    const imported = { ...block, imageAssetId: 'imported', imageUrl: '/assets/imported.jpg' };
    const request = { imageAssetId: null, imageUrl: 'https://images.example.test/source.jpg' };
    expect(() => verifySavedBlock(imported, request, imported)).not.toThrow();
    expect(() => verifySavedBlock({ ...imported, imageAssetId: 'different' }, request, imported)).toThrow(
        '图片',
    );
});
