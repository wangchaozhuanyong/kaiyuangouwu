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
import { MarketConfig, Product } from '../../types';

function cn(...classes: Array<string | false | null | undefined>) {
    return twMerge(clsx(classes));
}

export function ProductCard({
    product,
    market,
    locale,
    favorite,
    onOpen,
    onFavorite,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
}) {
    const isZh = locale.startsWith('zh');
    const variant = product.variants[0];
    const availability = productAvailability(variant);
    const stockLabel = productAvailabilityLabel(availability, isZh ? 'zh' : 'en');

    return (
        <article
            className="group relative flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-black/5 bg-[var(--paper)] pb-2.5 shadow-[var(--shadow-sm)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-black/10 hover:shadow-[var(--shadow-md)]"
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

            <div className="aspect-square w-full overflow-hidden bg-slate-50 [&_.image-placeholder]:h-full [&_.image-placeholder]:w-full [&_.image-placeholder]:bg-[var(--product-media-bg)] [&_img]:h-full [&_img]:w-full [&_img]:bg-[var(--product-media-bg)] [&_img]:object-contain">
                <ProductImage product={product} />
            </div>

            <strong className="mt-2 min-h-[1.35em] max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2.5 text-left text-[13px] font-semibold leading-[1.35] text-[var(--text)] min-[900px]:mt-[11px] min-[900px]:text-[15px]">
                {product.name}
            </strong>
            <span className="mt-[3px] block max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2.5 text-[11.5px] leading-[1.3] text-[var(--muted)] min-[900px]:mt-1.5 min-[900px]:text-[13px]">
                {trimText(product.description, 26)}
            </span>

            <footer className="mt-auto flex min-h-[42px] px-2.5 pt-2">
                <div className="flex min-w-0 flex-col gap-0.5 [&_b]:text-[16px] [&_b]:font-extrabold [&_b]:leading-[1.2] [&_b]:tracking-[-0.02em] [&_b]:text-[var(--accent)] [&_b]:[font-family:var(--font-numeric)]">
                    <PriceDisplay
                        value={variant ? variant.priceWithTax : 0}
                        currency={variant ? variant.currencyCode : market.currencyCode}
                        locale={locale}
                    />
                    <small
                        className={cn(
                            'overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] font-medium text-[var(--muted)]',
                            availability.soldOut && 'text-red-600',
                        )}
                    >
                        {stockLabel}
                    </small>
                </div>
            </footer>
        </article>
    );
}
