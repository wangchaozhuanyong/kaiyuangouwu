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
    centered = false,
    limit = 10,
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
    centered?: boolean;
    limit?: number;
    className?: string;
    plain?: boolean;
    compact?: boolean;
    enabled?: boolean;
    onProduct: (product: Product) => void;
}) {
    const query = useDailyRecommendations(api, market, language, enabled);
    // This document keeps its first selection, including across midnight. A full
    // reload fetches today's selection; recommendations are never persisted.
    const data = query.data;
    const products = data?.items.slice(0, limit) ?? [];
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
                    {products.map(product => (
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
            title={centered ? undefined : title}
            centerLabel={centered ? title : undefined}
            kind="recommendations"
            className={className}
            products={products}
            loading={!data && !unavailable}
            skeletonCount={limit}
            appearance={plain ? 'plain' : undefined}
            market={market}
            locale={locale}
            language={language}
            onProduct={onProduct}
        />
    );
}
