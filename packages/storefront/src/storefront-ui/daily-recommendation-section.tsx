import { ShopApi } from '../api';
import { ProductRow } from '../components/common/product-row';
import { useDailyRecommendations } from '../hooks/useDailyRecommendations';
import { MarketConfig, Product, StorefrontLanguage } from '../types';

import { EmptyState, SectionHeader } from './page-shell';
import { ProductSection } from './product-section';

export function DailyRecommendationSection({
    api,
    market,
    locale,
    language,
    title,
    className,
    plain = false,
    compact = false,
    enabled = true,
    onProduct,
}: {
    api: ShopApi;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    title: string;
    className?: string;
    plain?: boolean;
    compact?: boolean;
    enabled?: boolean;
    onProduct: (product: Product) => void;
}) {
    const query = useDailyRecommendations(api, market, language, enabled);
    // Yesterday's cached picks must not masquerade as today's recommendations after a failed refresh.
    const data = query.data && Date.parse(query.data.expiresAt) > Date.now() ? query.data : undefined;
    const unavailable = query.isError || query.isPaused;
    if (unavailable && !data)
        return (
            <section className={`product-section ${className ?? ''}`}>
                <EmptyState
                    icon={null}
                    compact
                    title={title}
                    detail={language === 'zh' ? '推荐暂时无法加载' : 'Recommendations unavailable'}
                    action={language === 'zh' ? '重试' : 'Retry'}
                    onAction={() => void query.refetch()}
                />
            </section>
        );
    if (compact && data)
        return (
            <section className={`product-section ${className ?? ''}`}>
                <SectionHeader title={title} icon={false} />
                <div className="search-recommendation-list">
                    {data.items.map(product => (
                        <ProductRow
                            key={product.id}
                            product={product}
                            market={market}
                            locale={locale}
                            language={language}
                            layout="compact"
                            showDescription={false}
                            onOpen={() => onProduct(product)}
                        />
                    ))}
                    {!data.items.length && (
                        <p>{language === 'zh' ? '暂无可推荐商品' : 'No products available'}</p>
                    )}
                </div>
            </section>
        );
    return (
        <ProductSection
            title={title}
            kind="recommendations"
            className={className}
            products={data?.items ?? []}
            loading={!data && !unavailable}
            skeletonCount={10}
            appearance={plain ? 'plain' : undefined}
            market={market}
            locale={locale}
            language={language}
            onProduct={onProduct}
        />
    );
}
