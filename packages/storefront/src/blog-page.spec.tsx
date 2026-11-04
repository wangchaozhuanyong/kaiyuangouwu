// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { emptyBlogDraft } from '../../storefront-content-plugin/src/shared/news-blog';
import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { BlogPage } from './pages/blog-page';
import { fetchPublicPage, publicSeoQueryKey } from './storefront-page-data';
const runtime = vi.hoisted(() => ({
    language: 'zh',
    market: { code: 'synthetic-a', currencyCode: 'MYR' },
    route: { category: 'claude' },
}));
vi.mock('./page-readiness', async original => ({
    ...(await original<object>()),
    usePageRouteCommit: () => undefined,
}));
vi.mock('./StorefrontContext', () => ({
    useStorefront: () => runtime,
}));
vi.mock('./storefront-page-data', async original => ({
    ...(await original<object>()),
    fetchPublicPage: vi.fn(),
}));
afterEach(() => {
    vi.clearAllMocks();
    runtime.language = 'zh';
    runtime.market = { code: 'synthetic-a', currencyCode: 'MYR' };
    runtime.route = { category: 'claude' };
});
it('adopts the returned SEO metadata in the same scoped Query cache after a filtered client navigation', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const page = syntheticPage('synthetic-a', 'zh_Hans', 'home');
    page.request = { kind: 'blog', input: { category: 'claude', skip: 0, take: 12 } };
    page.requestKey = publicPageRequestKey(page.request);
    page.blog = {
        title: '已发布的新闻栏目',
        description: '当前分类说明',
        items: [],
        totalItems: 0,
        featured: null,
        article: null,
        relatedArticles: [],
    };
    if (!page.seo) throw new Error('Expected synthetic SEO metadata');
    page.seo = { ...page.seo, title: page.blog.title, requestKey: page.requestKey };
    vi.mocked(fetchPublicPage).mockResolvedValue(page);
    const client = new QueryClient();
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <BlogPage />
                </QueryClientProvider>,
            );
            return Promise.resolve();
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(node.querySelector('main')?.getAttribute('aria-label')).toBe('已发布的新闻栏目');
        expect(node.querySelector('.blog-categories a[aria-current="page"]')?.textContent).toBe('Claude');
        expect(client.getQueryData(publicSeoQueryKey('synthetic-a:MYR', 'zh_Hans', page.request))).toEqual(
            page.seo,
        );
        expect(
            client.getQueryData(publicSeoQueryKey('another-store:MYR', 'zh_Hans', page.request)),
        ).toBeUndefined();
    } finally {
        await act(() => Promise.resolve(root.unmount()));
        node.remove();
        client.clear();
    }
});

it.each([
    'currency',
    'failure',
    'missing',
    'channel',
    'language',
    'article',
    'filter',
    'empty-list',
] as const)(
    'keeps currency-independent editorial data without crossing content identity: %s',
    async outcome => {
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        runtime.market.currencyCode = 'CNY';
        const listing = outcome === 'filter' || outcome === 'empty-list';
        let slug = listing ? undefined : 'handoff';
        const page = syntheticPage('synthetic-a', 'zh_Hans', 'home');
        const article = {
            ...emptyBlogDraft(),
            id: 'fixture-article',
            slug: 'handoff',
            version: 1,
            title: '已发布文章',
            body: '## 使用示例\n已确认的公开正文。',
            publishedAt: '2026-11-04T00:00:00Z',
            reviewedAt: null,
            reviewerName: null,
            readingMinutes: 1,
        };
        page.blog = {
            title: '已发布栏目',
            description: '公开编辑内容',
            items: [],
            totalItems: 0,
            featured: null,
            article: listing ? null : article,
            relatedArticles: [],
        };
        const request = listing
            ? { kind: 'blog' as const, input: { category: 'claude', skip: 0, take: 12 } }
            : { kind: 'blog' as const, id: 'handoff', input: {} };
        const key = [
            'storefront',
            'synthetic-a:CNY',
            'zh_Hans',
            'public-content',
            publicPageRequestKey(request),
        ];
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const observedAt = Date.now() - 1000;
        client.setQueryData(key, page.blog, { updatedAt: observedAt });
        let finish!: (value: Awaited<ReturnType<typeof fetchPublicPage>>) => void;
        let fail!: (reason: Error) => void;
        vi.mocked(fetchPublicPage).mockReturnValue(
            new Promise((resolve, reject) => {
                finish = resolve;
                fail = reject;
            }),
        );
        const node = document.createElement('div');
        document.body.append(node);
        const root = createRoot(node);
        const render = () =>
            root.render(
                <QueryClientProvider client={client}>
                    <BlogPage slug={slug} />
                </QueryClientProvider>,
            );
        try {
            await act(async () => {
                render();
                await Promise.resolve();
            });
            const originalMain = node.querySelector('main');
            const originalTitle = listing ? page.blog.title : article.title;
            expect(node.textContent).toContain(originalTitle);
            runtime.market.currencyCode = 'MYR';
            if (outcome === 'channel') runtime.market.code = 'another-store';
            if (outcome === 'language') runtime.language = 'en';
            if (outcome === 'article') slug = 'different-article';
            if (outcome === 'filter') runtime.route.category = 'skills';
            await act(async () => {
                render();
                await Promise.resolve();
            });
            if (['channel', 'language', 'article', 'filter'].includes(outcome)) {
                expect(node.textContent).not.toContain(originalTitle);
                return;
            }
            expect(node.querySelector('main')).toBe(originalMain);
            expect(node.textContent).toContain(originalTitle);
            const nextKey = [...key];
            nextKey[1] = 'synthetic-a:MYR';
            expect(client.getQueryState(nextKey)?.dataUpdatedAt).toBe(observedAt);
            let refresh: Promise<void> | undefined;
            await act(async () => {
                refresh = client.refetchQueries({ queryKey: nextKey, exact: true }, { cancelRefetch: false });
                await Promise.resolve();
            });
            expect(node.querySelector('main')).toBe(originalMain);
            await act(async () => {
                if (outcome === 'failure') fail(new DOMException('Request interrupted', 'AbortError'));
                else if (outcome === 'missing') finish(undefined);
                else {
                    const updated = structuredClone(page);
                    if (updated.blog) {
                        updated.blog.title = '更新后的栏目';
                        if (updated.blog.article) updated.blog.article.title = '更新后的文章';
                    }
                    finish(updated);
                }
                await refresh;
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            if (outcome === 'failure') {
                expect(node.querySelector('main')).toBe(originalMain);
                expect(node.textContent).toContain(originalTitle);
                expect(client.getQueryState(nextKey)?.status).toBe('error');
            } else if (outcome === 'missing') expect(node.textContent).not.toContain(originalTitle);
            else expect(node.textContent).toContain(listing ? '更新后的栏目' : '更新后的文章');
        } finally {
            await act(async () => {
                finish(undefined);
                await Promise.resolve();
                root.unmount();
                client.clear();
            });
            node.remove();
        }
    },
);
