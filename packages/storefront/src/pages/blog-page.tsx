import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';

import { type BlogPublicPage } from '../../../storefront-content-plugin/src/shared/news-blog';
import {
    type PublicPageRequest,
    publicPageRequestKey,
} from '../../../storefront-content-plugin/src/shared/public-page-data';
import { PageBackLink } from '../components/common/page-back-link';
import { languageCodeFor } from '../i18n';
import { storefrontInitialQueryError, storefrontQueryPresentation } from '../loading-state';
import { usePageRouteCommit } from '../page-readiness';
import {
    publicQueryMeta,
    storefrontPlaceholderData,
    storefrontQueryKeys,
    storefrontQueryRetry,
} from '../query-client';
import { hasStorefrontBackSource } from '../storefront-navigation-history';
import { fetchPublicPage, publicSeoQueryKey } from '../storefront-page-data';
import { routeFromRouterLocation, routeHref } from '../storefront-router';
import { AsyncRouteStatePage, Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';

import { BlogContent, blogArticleBackRoute, blogListBackRoute } from './blog-content';
import { blogLabels } from './blog-labels';
export function BlogPage({ slug }: { slug?: string }) {
    usePageRouteCommit();
    const router = useRouter({ warn: false });
    const client = useQueryClient();
    const runtime = useStorefront();
    const { market } = runtime;
    const language = runtime.route.publicLanguage ?? runtime.language;
    const input = {
        term: runtime.route.term,
        category: runtime.route.category,
        skip: ((runtime.route.page ?? 1) - 1) * 12,
        take: 12,
        fromBlogList: slug ? runtime.route.fromBlogList : undefined,
    };
    const request: PublicPageRequest = {
        kind: 'blog',
        ...(slug ? { id: slug } : {}),
        input,
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
    const returnRoute = slug ? blogArticleBackRoute(input, language) : blogListBackRoute(language);
    const backToSource = !slug && router && hasStorefrontBackSource(router);
    const onReturn = (target: typeof returnRoute) =>
        backToSource ? runtime.goBack() : runtime.returnToRoute(target);
    if (slug && query.isSuccess && !query.data?.article) {
        const labels = blogLabels[language];
        const list = routeHref(returnRoute);
        return (
            <Subpage
                title={labels.blog}
                language={language}
                back={<PageBackLink href={list} label={labels.backToBlog} />}
            >
                <section className="blog-empty" role="status">
                    <h1 className="type-section">
                        {language === 'zh' ? '这篇文章暂无中文版' : 'This article is unavailable in English'}
                    </h1>
                    <a className="blog-read-link type-action" href={list}>
                        {labels.browse}
                    </a>
                </section>
            </Subpage>
        );
    }
    if (query.data)
        return (
            <BlogContent
                language={language}
                page={query.data}
                input={input}
                onReturn={onReturn}
                backToSource={backToSource}
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
            onBack={() => onReturn(returnRoute)}
            onRetry={() => void query.refetch({ cancelRefetch: false })}
        />
    );
}
