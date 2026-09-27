import { type PropsWithChildren } from 'react';

import { routeHref } from '../../storefront-router';
import { prefetchProductAsset } from '../../storefront-ui/product-display';
import { type Product, type StorefrontLanguage } from '../../types';

/** Keep media and copy inside their navigation target; sibling overlays can lose hit testing to images. */
export function ProductDetailLink({
    product,
    language,
    onOpen,
    className,
    title,
    children,
}: PropsWithChildren<{
    product: Product;
    language: StorefrontLanguage;
    onOpen: () => void;
    className: string;
    title?: string;
}>) {
    return (
        <a
            className={className}
            href={routeHref({ name: 'product', id: product.id })}
            aria-label={`${language === 'zh' ? '查看' : 'View'} ${product.name}`}
            title={title}
            onClick={event => {
                if (
                    event.defaultPrevented ||
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                ) {
                    return;
                }
                event.preventDefault();
                onOpen();
            }}
            onPointerEnter={() => prefetchProductAsset(product)}
            onPointerDown={() => prefetchProductAsset(product)}
            onFocus={() => prefetchProductAsset(product)}
        >
            {children}
        </a>
    );
}
