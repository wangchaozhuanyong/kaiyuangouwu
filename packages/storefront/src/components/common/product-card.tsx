/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import clsx from 'clsx';
import { Check, Download, Heart, Plus } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

import {
    prefetchProductAsset,
    PriceDisplay,
    ProductImage,
    trimText,
} from '../../storefront-ui/product-display';
import { DigitalDeliveryMode, MarketConfig, Product } from '../../types';

function cn(...classes: Array<string | false | null | undefined>) {
    return twMerge(clsx(classes));
}

export function ProductCard({
    product,
    market,
    locale,
    adding,
    favorite,
    onOpen,
    onFavorite,
    onAdd,
}: {
    product: Product;
    market: MarketConfig;
    locale: string;
    adding: boolean;
    favorite?: boolean;
    onOpen: () => void;
    onFavorite?: () => void;
    onAdd: () => void;
}) {
    const isZh = locale.startsWith('zh');
    const variant = product.variants[0];
    const isDigital = variant?.customFields?.fulfillmentType === 'digital';
    const digitalDeliveryMode: DigitalDeliveryMode =
        variant?.customFields?.digitalDeliveryMode ?? 'manual_service';
    const isAutoCard = isDigital && digitalDeliveryMode === 'auto_card';
    const isFileDownload = isDigital && digitalDeliveryMode === 'file_download';
    const isOutOfStock =
        (variant?.customFields?.fulfillmentType === 'physical' && variant.stockLevel === 'OUT_OF_STOCK') ||
        (isAutoCard && (variant.autoCardAvailableStock ?? 0) < 1);

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

            <div className="pointer-events-none absolute left-2 top-2 z-20">
                {isDigital ? (
                    <span className="inline-flex items-center gap-[3px] rounded bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] [&_svg]:size-[11px]">
                        <Download aria-hidden="true" />
                        {isAutoCard
                            ? isZh
                                ? '邮箱自动发卡'
                                : 'Automatic email delivery'
                            : isFileDownload
                              ? isZh
                                  ? '数字文件下载'
                                  : 'File download'
                              : isZh
                                ? '人工数字服务'
                                : 'Manual service'}
                    </span>
                ) : isOutOfStock ? (
                    <span className="inline-flex items-center rounded bg-slate-500 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-white shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
                        {isZh ? '暂时缺货' : 'Out of stock'}
                    </span>
                ) : (
                    <span className="inline-flex items-center rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.02em] text-white shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
                        {isZh ? '现货速发' : 'In Stock'}
                    </span>
                )}
            </div>

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

            <strong className="mt-2 min-h-[2.7em] max-w-full overflow-hidden px-2.5 text-left text-[13px] font-semibold leading-[1.35] text-[var(--text)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] min-[900px]:mt-[11px] min-[900px]:text-[15px]">
                {product.name}
            </strong>
            <span className="mt-[3px] block max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-2.5 text-[11.5px] leading-[1.3] text-[var(--muted)] min-[900px]:mt-1.5 min-[900px]:text-[13px]">
                {trimText(product.description, 26) || variant?.sku}
            </span>

            <footer className="mt-auto flex min-h-[38px] items-end justify-between px-2.5 pt-2">
                <div className="flex flex-col gap-px [&_b]:text-[16px] [&_b]:font-extrabold [&_b]:leading-[1.2] [&_b]:tracking-[-0.02em] [&_b]:text-[var(--accent)] [&_b]:[font-family:var(--font-numeric)]">
                    <PriceDisplay
                        value={variant ? variant.priceWithTax : 0}
                        currency={variant ? variant.currencyCode : market.currencyCode}
                        locale={locale}
                    />
                    <small className="text-[10.5px] font-medium text-[var(--muted)]">
                        {isZh ? '含税' : 'incl. tax'}
                    </small>
                </div>
                <button
                    type="button"
                    className={cn(
                        'relative z-20 grid size-[34px] place-items-center rounded-full border border-transparent bg-[var(--text)] p-0 text-white shadow-[0_2px_6px_rgba(0,0,0,0.14)] transition-[transform,background-color,color] duration-150 hover:scale-[1.06] hover:bg-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none [&_svg]:size-4',
                        adding && 'bg-[var(--success)] text-white hover:bg-[var(--success)]',
                    )}
                    onClick={onAdd}
                    disabled={!variant || adding || isOutOfStock}
                    aria-label={`${isZh ? '加入购物车' : 'Add to cart'} ${product.name}`}
                >
                    {adding ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                </button>
            </footer>
        </article>
    );
}
