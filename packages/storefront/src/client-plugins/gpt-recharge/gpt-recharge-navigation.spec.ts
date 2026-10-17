import { describe, expect, it } from 'vitest';

import { type CollectionSummary, type StorefrontContentBlock, type StorefrontContentItem } from '../../types';

import { resolveGptRechargeProductsCollection } from './gpt-recharge-navigation';

const collection = (
    id: string,
    name: string,
    slug: string,
    children: CollectionSummary[] = [],
): CollectionSummary => ({
    id,
    name,
    slug,
    children,
    description: '',
    position: 0,
    parentId: 'root',
    featuredAsset: null,
});

const target = (id: string, overrides: Partial<StorefrontContentItem> = {}): StorefrontContentItem => ({
    id: `link-${id}`,
    enabled: true,
    position: 0,
    imageUrl: null,
    targetType: 'COLLECTION',
    targetValue: id,
    label: 'ChatGPT',
    description: '',
    ...overrides,
});

const block = (
    items: StorefrontContentItem[],
    overrides: Partial<StorefrontContentBlock> = {},
): StorefrontContentBlock => ({
    id: 'published-navigation',
    code: 'published-navigation',
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
    title: '',
    subtitle: '',
    body: '',
    ctaLabel: '',
    items,
    ...overrides,
});

describe('GPT recharge product category navigation', () => {
    it('resolves normalized current-store slugs and localized category names', () => {
        const bySlug = collection('store-specific-id', '会员专区', 'Ｃｈａｔ－ＧＰＴ');
        expect(resolveGptRechargeProductsCollection([bySlug])).toBe(bySlug);
        const byName = collection('another-store-id', 'ChatGPT 订阅', 'memberships');
        expect(resolveGptRechargeProductsCollection([byName])).toBe(byName);
    });

    it('resolves the published GPT成品 taxonomy without selecting Codex subscriptions', () => {
        const accounts = collection('finished-accounts', 'GPT成品', 'ready-accounts');
        const categories = [
            collection('codex-subscriptions', 'Codex订阅', 'codex'),
            accounts,
            collection('other-tools', 'GPT工具', 'gpt-tools'),
        ];
        expect(resolveGptRechargeProductsCollection(categories)).toBe(accounts);
        expect(
            resolveGptRechargeProductsCollection(categories, [
                block([target(accounts.id, { label: 'GPT成品' })]),
            ]),
        ).toBe(accounts);
    });

    it.each([
        'ChatGPT成品',
        'ChatGPT 成品号',
        'ChatGPT成品账号',
        'ChatGPT 账号',
        'ChatGPT account',
        'ChatGPT accounts',
    ])('recognizes the explicit ChatGPT account category %s', name => {
        const accounts = collection('accounts', name, 'finished-accounts');
        expect(resolveGptRechargeProductsCollection([accounts])).toBe(accounts);
    });

    it.each([
        'GPT finished product',
        'GPT finished products',
        'ChatGPT finished product',
        'ChatGPT finished products',
    ])('resolves the English finished-product category name %s', name => {
        const accounts = collection('current-finished-accounts', name, 'ready-memberships');
        expect(
            resolveGptRechargeProductsCollection([
                collection('codex', 'Codex Subscription', 'gpt-subscription'),
                collection('tools', 'GPT tools', 'gpt-tools'),
                accounts,
            ]),
        ).toBe(accounts);
    });

    it('resolves the localized finished-product slug from the current public catalog', () => {
        // Same taxonomy as the live bilingual readback; all IDs are synthetic and store-independent.
        const accounts = collection(
            'current-finished-accounts',
            'Ready accounts',
            'chatgpt-finished-product',
        );
        expect(
            resolveGptRechargeProductsCollection([
                collection('codex', 'Codex Subscription', 'gpt-subscription'),
                accounts,
            ]),
        ).toBe(accounts);
        const selected = collection('published-target', 'Memberships', 'memberships');
        expect(
            resolveGptRechargeProductsCollection(
                [selected, accounts],
                [block([target(selected.id, { label: 'GPT finished products' })])],
            ),
        ).toBe(selected);
    });

    it('retains ambiguity and stale-target protection for translated finished-product categories', () => {
        const first = collection('local-first', 'GPT finished products', 'chatgpt-finished-product');
        const second = collection('local-second', 'ChatGPT finished products', 'ready-memberships');
        expect(resolveGptRechargeProductsCollection([first, second])).toBeNull();
        expect(
            resolveGptRechargeProductsCollection(
                [first],
                [block([target('outside-this-store', { label: 'GPT finished products' })])],
            ),
        ).toBeNull();
        expect(
            resolveGptRechargeProductsCollection(
                [first, second],
                [
                    block([
                        target(first.id, { label: 'GPT finished products' }),
                        target(second.id, { label: 'ChatGPT finished products' }),
                    ]),
                ],
            ),
        ).toBeNull();
    });

    it('finds a child category and prefers the exact ChatGPT slug over a broader named category', () => {
        const child = collection('actual-child', '订阅套餐', 'chatgpt');
        const parent = collection('parent', 'AI 服务', 'ai', [child]);
        expect(resolveGptRechargeProductsCollection([parent, collection('other', 'ChatGPT', 'other')])).toBe(
            child,
        );
    });

    it('uses an explicit published ChatGPT category target from the current channel', () => {
        const selected = collection('merchant-choice', '会员服务', 'members');
        const inferred = collection('inferred', 'ChatGPT', 'chatgpt');
        expect(
            resolveGptRechargeProductsCollection(
                [selected, inferred],
                [block([target(selected.id)], { type: 'NAVIGATION' })],
            ),
        ).toBe(selected);
    });

    it('does not substitute another category for a stale or cross-store published target', () => {
        expect(
            resolveGptRechargeProductsCollection(
                [collection('local', 'ChatGPT', 'chatgpt')],
                [block([target('belongs-to-another-store')])],
            ),
        ).toBeNull();
    });

    it('ignores disabled links and unrelated target types or plugin placement configuration', () => {
        const actual = collection('actual', 'ChatGPT', 'chatgpt');
        expect(
            resolveGptRechargeProductsCollection(
                [actual],
                [
                    block([target('disabled-block')], { enabled: false }),
                    block([target('disabled-link', { enabled: false })]),
                    block([target('https://example.invalid', { targetType: 'URL' })]),
                    block([target('plugin-placement')], { type: 'CLIENT_PLUGINS' }),
                ],
            ),
        ).toBe(actual);
    });

    it('returns no destination when the category is missing or only unrelated GPT content exists', () => {
        expect(resolveGptRechargeProductsCollection([])).toBeNull();
        expect(
            resolveGptRechargeProductsCollection([
                collection('tools', 'ChatGPT 提示词工具', 'chatgpt-tools'),
                collection('codex', 'Codex订阅', 'codex'),
                collection('generic', 'GPT', 'gpt'),
                collection('accounts', 'GPT账号', 'gpt-accounts'),
                collection('gpt-tools', 'GPT工具', 'gpt-tools'),
                collection('mixed', 'Codex GPT订阅', 'codex-gpt'),
            ]),
        ).toBeNull();
    });

    it('returns no destination for conflicting published targets or equally ranked categories', () => {
        const first = collection('first', 'ChatGPT', 'chatgpt');
        const second = collection('second', 'ChatGPT', 'chatgpt');
        expect(resolveGptRechargeProductsCollection([first, second])).toBeNull();
        expect(
            resolveGptRechargeProductsCollection(
                [first, second],
                [block([target(first.id), target(second.id)])],
            ),
        ).toBeNull();
        expect(
            resolveGptRechargeProductsCollection([first], [block([target(first.id), target(first.id)])]),
        ).toBe(first);
    });
});
