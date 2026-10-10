import { useQuery } from '@tanstack/react-query';

import { ContentText } from '../../../storefront-content-plugin/src/shared/content-text';
import {
    publicLocalizedHref,
    publicPageRequestKey,
} from '../../../storefront-content-plugin/src/shared/public-page-data';
import { type PublicGuideContent } from '../../../storefront-content-plugin/src/shared/public-seo';
import { languageCodeFor } from '../i18n';
import { publicQueryMeta, storefrontQueryKeys, storefrontQueryRetry } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { fetchPublicPage } from '../storefront-page-data';
import { Subpage } from '../storefront-ui/page-shell';
import { useStorefront } from '../StorefrontContext';
import { type StorefrontLanguage } from '../types';

/** Published business-reviewed content. The server and interactive route share this component. */
export function GuideContent({
    content,
    language,
}: {
    content: PublicGuideContent;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    return (
        <main className="page subpage legal-page">
            <article className="legal-managed-content">
                <h1>{content.title}</h1>
                {content.summary && <p>{content.summary}</p>}
                <ContentText>{content.body}</ContentText>
                <p className="type-helper">
                    {content.authorName && (
                        <span>
                            {isZh ? '作者：' : 'Author: '}
                            {content.authorName} ·{' '}
                        </span>
                    )}
                    {isZh ? '审核：' : 'Reviewed by: '}
                    {content.reviewerName} ·{' '}
                    <time dateTime={content.reviewedAt}>{content.reviewedAt.slice(0, 10)}</time>
                </p>
                {content.sources.length > 0 && (
                    <section aria-label={isZh ? '资料来源' : 'Sources'}>
                        <h2>{isZh ? '资料来源' : 'Sources'}</h2>
                        <ul>
                            {content.sources.map(source => (
                                <li key={source.url}>
                                    <a href={source.url} rel="noopener noreferrer">
                                        {source.label || source.url}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
                {content.relatedProducts.length > 0 && (
                    <section aria-label={isZh ? '相关商品' : 'Related products'}>
                        <h2>{isZh ? '相关商品' : 'Related products'}</h2>
                        <ul>
                            {content.relatedProducts.map(product => (
                                <li key={product.id}>
                                    <a
                                        href={publicLocalizedHref(
                                            `/product?id=${encodeURIComponent(product.id)}`,
                                            languageCodeFor(language),
                                        )}
                                    >
                                        {product.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </article>
        </main>
    );
}

export function GuidePage({ slug }: { slug: string }) {
    const runtime = useStorefront();
    const { language, market } = runtime;
    const languageCode = languageCodeFor(language);
    const key = [
        ...storefrontQueryKeys.scope(storefrontQueryKeys.market(market), languageCode),
        'public-content',
        publicPageRequestKey({ kind: 'article', id: slug }),
    ];
    const query = useQuery({
        queryKey: key,
        queryFn: async ({ signal }) =>
            (
                await fetchPublicPage(
                    languageCode,
                    market.currencyCode,
                    signal,
                    { kind: 'article', id: slug },
                    market.code,
                )
            )?.publicContent ?? null,
        staleTime: 30_000,
        retry: storefrontQueryRetry,
        meta: publicQueryMeta(),
    });
    if (query.data) return <GuideContent content={query.data} language={language} />;
    return (
        <Subpage
            title={language === 'zh' ? '选购与使用指南' : 'Guides'}
            language={language}
            onBack={runtime.goBack}
        >
            {query.isPending ? (
                <PageSkeleton language={language} />
            ) : (
                <div className="empty-state" role={query.isError ? 'alert' : 'status'}>
                    <p>
                        {query.isError
                            ? storefrontErrorMessage(query.error, language)
                            : language === 'zh'
                              ? '没有找到已发布的指南'
                              : 'Published guide not found'}
                    </p>
                    {query.isError && (
                        <button type="button" onClick={() => void query.refetch({ cancelRefetch: false })}>
                            {language === 'zh' ? '重试' : 'Retry'}
                        </button>
                    )}
                </div>
            )}
        </Subpage>
    );
}
