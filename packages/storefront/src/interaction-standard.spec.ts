import { describe, expect, it, vi } from 'vitest';

import {
    assertInteractionStandard,
    auditInteractionRoutes,
    checkInteractionSource,
    checkRouteAdmission,
    interactionSources,
} from '../scripts/check-interaction-standard.mjs';

describe('storefront interaction architecture guard', () => {
    it('rejects a second query cache, module-level business snapshots and direct or delegated request intervals', () => {
        for (const source of [
            'const client = new QueryClient()',
            'import { QueryClient as PageCache } from "@tanstack/react-query"; const client = new PageCache()',
            'import * as Query from "@tanstack/react-query"; const Cache = Query.QueryClient; const client = new (Cache as any)()',
            'const snapshots = new Map<string, Product[]>()',
            'const invoices = new Map<string, NewInvoiceType>()',
            'const invoices = new Map<ImageStudioDraft, NewInvoiceType>()',
            'const state = { results: new Map() }',
            'window.setInterval(() => api.orders(), 2000)',
            'const refreshOrders = () => api.orders(); setInterval(refreshOrders, 2000)',
            'function tick() { query.refetch({cancelRefetch:false}) } setInterval(tick, 2000)',
        ])
            expect(checkInteractionSource('pages/new-page.tsx', source)).not.toEqual([]);
        expect(
            checkInteractionSource('pages/clock.tsx', 'setInterval(() => setNow(Date.now()), 1000)'),
        ).toEqual([]);
        expect(
            checkInteractionSource('pages/draft.tsx', 'const drafts = new Map<string, ImageStudioDraft>()'),
        ).toEqual([]);
    });
    // Each source is independent. Keep the normal per-test timeout instead of
    // assigning one 5s budget to the growing application corpus.
    it.each(interactionSources())('enforces the interaction contract in $file', ({ file, source }) => {
        expect(checkInteractionSource(file, source)).toEqual([]);
    });
    it('enforces registration and page-family coverage for all current route files', () => {
        expect(auditInteractionRoutes()).toEqual([]);
    });
    it('keeps first-frame geometry protection active on new CSS files', () => {
        expect(checkInteractionSource('pages/future.css', '.body { content-visibility: auto }')).not.toEqual(
            [],
        );
        expect(checkInteractionSource('pages/future.css', '.body { display: grid }')).toEqual([]);
    });
    it('rejects new route files without registration and classifications without a route, without fixing a page count', () => {
        const files = ['__root.tsx', 'index.tsx', 'home.tsx'];
        expect(checkRouteAdmission(['home'], ['home'], files)).toEqual([]);
        expect(checkRouteAdmission(['home'], ['home'], [...files, 'future.tsx'])).not.toEqual([]);
        expect(checkRouteAdmission(['home', 'future'], ['home'], [...files, 'future.tsx'])).not.toEqual([]);
        expect(checkRouteAdmission(['home'], ['home', 'retired'], files)).not.toEqual([]);
        expect(checkRouteAdmission(['home', 'home'], ['home'], files)).not.toEqual([]);
        expect(checkRouteAdmission(['home', 'future'], ['home', 'future'], [...files, 'future.tsx'])).toEqual(
            [],
        );
    });
    it('requires registration, classification and exact files for nested blog routes', () => {
        const files = ['__root.tsx', 'index.tsx', 'blog.index.tsx', 'blog.$slug.tsx'];
        const routes = ['blog', 'blog-article'];
        expect(checkRouteAdmission(routes, routes, files)).toEqual([]);
        expect(checkRouteAdmission(['blog'], ['blog'], files)).not.toEqual([]);
        expect(checkRouteAdmission(routes, ['blog'], files)).not.toEqual([]);
        expect(checkRouteAdmission(routes, routes, files.slice(0, -1))).not.toEqual([]);
        expect(checkRouteAdmission(routes, routes, [...files, 'blog.$other.tsx'])).not.toEqual([]);
    });
    it('blocks acceptance when a caller supplies violations', () => {
        expect(() =>
            assertInteractionStandard(checkInteractionSource('pages/future.tsx', 'const data = new Map()')),
        ).toThrow('模块级 Map');
        expect(() => assertInteractionStandard([])).not.toThrow();
    });
    it('makes the existing production-build verifier fail before artifact acceptance on an interaction violation', async () => {
        vi.doMock('../scripts/check-interaction-standard.mjs', () => ({
            assertInteractionStandard: () => {
                throw new Error('fixture interaction violation');
            },
        }));
        try {
            await expect(import('../scripts/verify-production-build.mjs')).rejects.toThrow(
                'fixture interaction violation',
            );
        } finally {
            vi.doUnmock('../scripts/check-interaction-standard.mjs');
            vi.resetModules();
        }
    });
    it('rejects page reloads, unscoped placeholders, cancelling refreshes and hidden-page polling in new code', () => {
        for (const source of [
            'window.location.reload()',
            '.future-module { content-visibility: auto; contain-intrinsic-size: auto 320px; }',
            'query.refetch()',
            'query?.refetch?.()',
            'query.fetchNextPage()',
            'query.refetch({cancelRefetch: true})',
            'query.fetchNextPage({})',
            'placeholderData: keepPreviousData',
            'refetchIntervalInBackground: true',
            'window.confirm("discard")',
        ])
            expect(checkInteractionSource('pages/new-page.tsx', source).length).toBeGreaterThan(0);
    });
    it('rejects navigation cache eviction except documented sensitive data owners', () => {
        expect(checkInteractionSource('plugins/new.tsx', 'useQuery({ gcTime: 0 })')).not.toEqual([]);
        expect(checkInteractionSource('plugins/new.tsx', 'useQuery({ "gcTime": 0 })')).not.toEqual([]);
        expect(checkInteractionSource('plugins/new.tsx', 'useQuery({ gcTime: 60000 })')).toEqual([]);
        expect(
            checkInteractionSource(
                'plugins/new.tsx',
                'useQuery({\n// @ephemeral-sensitive: private credential result discarded on exit.\ngcTime: 0 })',
            ),
        ).toEqual([]);
    });
    it('rejects text-only lazy fallbacks while accepting shared structural surfaces', () => {
        expect(
            checkInteractionSource(
                'pages/future-page.tsx',
                '<Suspense fallback={<p role="status">Loading</p>}/>',
            ),
        ).not.toEqual([]);
        expect(
            checkInteractionSource('pages/future-page.tsx', '<Suspense fallback={<PageSkeleton/>}/>'),
        ).toEqual([]);
        expect(checkInteractionSource('pages/future-page.tsx', '<Suspense fallback={null}/>')).toEqual([]);
    });
    it('permits explicit joining and restricts full reload to version recovery', () => {
        expect(
            checkInteractionSource('pages/new-page.tsx', 'query.refetch({ cancelRefetch: false })'),
        ).toEqual([]);
        expect(checkInteractionSource('StorefrontErrorBoundary.tsx', 'window.location.reload()')).toEqual([]);
        expect(checkInteractionSource('StorefrontUpdatePrompt.tsx', 'window.location.reload()')).toEqual([]);
    });
    it('rejects raw history returns outside the shared navigation and owned auth overlay', () => {
        for (const source of [
            'router.history.back()',
            'window.history.back()',
            'router.history?.back?.()',
            'history.go(-1)',
        ])
            expect(checkInteractionSource('pages/new-page.tsx', source)).not.toEqual([]);
        expect(checkInteractionSource('pages/new-page.tsx', 'goBackInStorefront(router)')).toEqual([]);
        expect(
            checkInteractionSource('pages/new-page.tsx', 'returnToStorefrontRoute(router, listRoute)'),
        ).toEqual([]);
        expect(
            checkInteractionSource('storefront-navigation-history.ts', 'router.history.go(delta)'),
        ).toEqual([]);
        expect(checkInteractionSource('auth-overlay-navigation-actions.ts', 'router.history.back()')).toEqual(
            [],
        );
    });
});
