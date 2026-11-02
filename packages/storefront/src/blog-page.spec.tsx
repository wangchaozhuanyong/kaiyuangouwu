// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';
import { syntheticPage } from '../e2e/seo-public/fixtures.mjs';

import { BlogPage } from './pages/blog-page';
import { fetchPublicPage, publicSeoQueryKey } from './storefront-page-data';
vi.mock('./page-readiness', async original => ({
    ...(await original<object>()),
    usePageRouteCommit: () => undefined,
}));
vi.mock('./StorefrontContext', () => ({
    useStorefront: () => ({
        language: 'zh',
        market: { code: 'synthetic-a', currencyCode: 'MYR' },
        route: { category: 'claude' },
    }),
}));
vi.mock('./storefront-page-data', async original => ({
    ...(await original<object>()),
    fetchPublicPage: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
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
