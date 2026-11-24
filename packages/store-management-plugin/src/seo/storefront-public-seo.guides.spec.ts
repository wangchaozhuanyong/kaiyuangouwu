import { describe, expect, it } from 'vitest';

import { relatedGuideLinks } from './storefront-public-seo.service';

const guide = (targetId: string, languageCode = 'zh_Hans', overrides = {}) => ({
    targetId,
    languageCode,
    payload: {
        title: `${targetId} 指南`,
        article: { body: '正文', reviewedAt: '2026-11-23' },
        ...overrides,
    },
});

describe('related guide links', () => {
    it('links other published guides in the same language', () => {
        expect(
            relatedGuideLinks([guide('codex'), guide('claude'), guide('grok')], {
                currentId: 'codex',
                languageCode: 'zh_Hans',
            }),
        ).toEqual([
            { id: 'claude', title: 'claude 指南' },
            { id: 'grok', title: 'grok 指南' },
        ]);
    });

    it('never links the current page, another language or an unpublished draft', () => {
        const drafts = [
            guide('codex'),
            guide('english-only', 'en'),
            guide('no-body', 'zh_Hans', { article: { body: '   ', reviewedAt: '2026-11-23' } }),
            guide('not-reviewed', 'zh_Hans', { article: { body: '正文', reviewedAt: null } }),
            guide('blank-title', 'zh_Hans', { title: '  ' }),
        ];
        expect(relatedGuideLinks(drafts, { currentId: 'codex', languageCode: 'zh_Hans' })).toEqual([]);
    });

    it('caps the list so a guide page keeps one product block above it', () => {
        const many = ['a', 'b', 'c', 'd', 'e'].map(id => guide(id));
        expect(relatedGuideLinks(many, { currentId: 'a', languageCode: 'zh_Hans' })).toHaveLength(3);
        expect(relatedGuideLinks(many, { currentId: 'a', languageCode: 'zh_Hans', limit: 2 })).toHaveLength(
            2,
        );
    });

    it('returns nothing when only the current guide is published', () => {
        expect(relatedGuideLinks([guide('codex')], { currentId: 'codex', languageCode: 'zh_Hans' })).toEqual(
            [],
        );
    });
});
