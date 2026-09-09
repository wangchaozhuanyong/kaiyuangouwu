/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import clsx from 'clsx';
import { Heart } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

import { productAvailability, productAvailabilityLabel } from '../../product-availability';
import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { MarketConfig, Product, StorefrontLanguage } from '../../types';

function cn(...classes: Array<string | false | null | undefined>) {
    return twMerge(clsx(classes));
}

export function ProductCard({
    product,
    market,
    locale,
    language,
    favorite,
    onOpen,
    onFavorite,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    language: StorefrontLanguage;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
}) {
    const isZh = language === 'zh';
    const variant = product.variants[0];
    const availability = productAvailability(variant);
    const stockLabel = productAvailabilityLabel(availability, isZh ? 'zh' : 'en');
    const description = trimText(product.description, product.description.length);
    const showDescription = description && description !== trimText(product.name, product.name.length);

    return (
        <article
            className="product-grid-card group relative isolate flex min-w-0 flex-col bg-transparent pb-2.5"
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            <button
                className="product-card-detail-link absolute inset-0 z-10 cursor-pointer rounded-[var(--radius-md)] border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                type="button"
                onClick={onOpen}
                aria-label={`${isZh ? '查看' : 'View'} ${product.name}`}
            />

            {onFavorite && (
                <button
                    className={cn(
                        'absolute right-2 top-2 z-20 grid size-[30px] place-items-center rounded-full border border-white/85 bg-white/90 p-0 text-[var(--muted)] shadow-[0_2px_6px_rgba(0,0,0,0.06)] backdrop-blur-md transition-[transform,color,background-color] duration-150 hover:scale-110 hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] [&_svg]:size-[15px]',
                        favorite && 'bg-white text-[var(--accent)]',
                    )}
                    type="button"
                    onClick={onFavorite}
                    aria-pressed={favorite}
                    aria-label={
                        favorite
                            ? isZh
                                ? `取消收藏 ${product.name}`
                                : `Remove ${product.name} from favorites`
                            : isZh
                              ? `收藏 ${product.name}`
                              : `Add ${product.name} to favorites`
                    }
                >
                    <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
            )}

            <div className="product-card-media aspect-square w-full overflow-hidden [&_.responsive-picture]:block [&_.responsive-picture]:h-full [&_.responsive-picture]:w-full [&_.image-placeholder]:h-full [&_.image-placeholder]:w-full [&_.image-placeholder]:bg-[var(--product-media-bg)] [&_img]:block [&_img]:h-full [&_img]:w-full [&_img]:object-contain">
                <ProductImage product={product} />
            </div>

            <strong className="mt-2 line-clamp-2 min-h-[2.7em] max-w-full break-words text-left text-[13px] font-semibold leading-[1.35] text-[var(--text)] min-[1024px]:mt-2.5 min-[1024px]:text-[15px]">
                {product.name}
            </strong>
            {showDescription && (
                <span className="mt-1 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11.5px] leading-[1.3] text-[var(--muted)] min-[1024px]:text-[13px]">
                    {description}
                </span>
            )}

            <footer className="mt-auto flex min-h-[42px] items-center justify-between gap-2 pt-2">
                <div className="min-w-0 [&_b]:text-[16px] [&_b]:font-extrabold [&_b]:leading-[1.2] [&_b]:tracking-[-0.02em] [&_b]:text-[var(--accent)] [&_b]:[font-family:var(--font-numeric)]">
                    <PriceDisplay
                        value={variant ? variant.priceWithTax : 0}
                        currency={variant ? variant.currencyCode : market.currencyCode}
                        locale={locale}
                    />
                </div>
                <small
                    className={cn(
                        'min-w-0 max-w-[52%] shrink overflow-hidden text-ellipsis whitespace-nowrap text-right text-[10.5px] font-medium text-[var(--muted)]',
                        availability.soldOut && 'text-red-600',
                    )}
                >
                    {stockLabel}
                </small>
            </footer>
        </article>
    );
}
