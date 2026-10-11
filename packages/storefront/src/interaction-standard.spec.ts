import { describe, expect, it } from 'vitest';

import { auditInteractionStandard, checkInteractionSource } from '../scripts/check-interaction-standard.mjs';

describe('storefront interaction architecture guard', () => {
    it('enforces the standard across current pages, hooks and client plugins', () => {
        expect(auditInteractionStandard()).toEqual([]);
    });
    it('rejects page reloads, unscoped placeholders, cancelling refreshes and hidden-page polling in new code', () => {
        for (const source of [
            'window.location.reload()',
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
