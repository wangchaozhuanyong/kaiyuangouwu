import { useQuery, useQueryClient } from '@tanstack/react-query';

import { type BlogPublicPage } from '../../../storefront-content-plugin/src/shared/news-blog';
import {
    type PublicPageRequest,
    publicPageRequestKey,
} from '../../../storefront-content-plugin/src/shared/public-page-data';
import { languageCodeFor } from '../i18n';
import { storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import { usePageRouteCommit } from '../page-readiness';
import {
    publicQueryMeta,
    storefrontPlaceholderData,
    storefrontQueryKeys,
    storefrontQueryRetry,
} from '../query-client';
import { fetchPublicPage, publicSeoQueryKey } from '../storefront-page-data';
import { routeFromRouterLocation } from '../storefront-router';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';

import { BlogContent } from './blog-content';
export function BlogPage({ slug }: { slug?: string }) {
    usePageRouteCommit();
    const client = useQueryClient();
    const runtime = useStorefront();
    const { language, market } = runtime;
    const input = {
        term: runtime.route.term,
        category: runtime.route.category,
        skip: ((runtime.route.page ?? 1) - 1) * 12,
        take: 12,
    };
    const request: PublicPageRequest = {
        kind: 'blog',
        ...(slug ? { id: slug } : {}),
        input: slug ? {} : input,
    };
    const key = [
        ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCodeFor(language)),
        'public-content',
        publicPageRequestKey(request),
    ];
    // Published editorial text and links contain no currency prices. Reuse only
    // this channel/language/request, keeping its response age in the root cache.
    const publishedRead = client
        .getQueryCache()
        .findAll({
            predicate: cached => {
                const [owner, scope, previousLanguage, kind, identity] = cached.queryKey;
                return (
                    cached.queryKey.length === key.length &&
                    owner === key[0] &&
                    typeof scope === 'string' &&
                    scope.startsWith(`${market.code}:`) &&
                    /^[A-Z]{3}$/u.test(scope.slice(market.code.length + 1)) &&
                    previousLanguage === key[2] &&
                    kind === key[3] &&
                    identity === key[4] &&
                    cached.state.data !== undefined
                );
            },
        })
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
    const query = useQuery({
        queryKey: key,
        queryFn: async ({ signal }) => {
            const page = await fetchPublicPage(
                languageCodeFor(language),
                market.currencyCode,
                signal,
                request,
                market.code,
            );
            if (page)
                client.setQueryData(
                    publicSeoQueryKey(storefrontQueryKeys.market(market), languageCodeFor(language), request),
                    page.seo ?? null,
                    { updatedAt: page.generatedAt },
                );
            return page?.blog ?? null;
        },
        staleTime: 30000,
        retry: storefrontQueryRetry,
        meta: publicQueryMeta(),
        initialData: publishedRead?.state.data as BlogPublicPage | null | undefined,
        initialDataUpdatedAt: publishedRead?.state.dataUpdatedAt,
        placeholderData: (previous, previousQuery) =>
            storefrontPlaceholderData(previous, previousQuery?.queryKey, key),
    });
    const state = storefrontQueryPresentation(query);
    const error = storefrontInitialQueryError(query, language);
    if (query.data)
        return (
            <BlogContent
                page={query.data}
                input={input}
                onNavigate={target => {
                    const url = new URL(target, window.location.origin);
                    runtime.navigate(
                        routeFromRouterLocation(url.pathname, Object.fromEntries(url.searchParams)),
                    );
                }}
            />
        );
    return (
        <AsyncRouteStatePage
            routeName={slug ? 'blog-article' : 'blog'}
            language={language}
            state={error || !state.initialLoading ? 'error' : 'loading'}
            error={error ?? ''}
            onBack={runtime.goBack}
            onRetry={() => void query.refetch({ cancelRefetch: false })}
        />
    );
}
