import React, { ImgHTMLAttributes, useState } from 'react';

export interface AdminThumbnailOptions {
    width?: number;
    height?: number;
    preset?: string;
    format?: 'webp' | 'jpeg' | 'png' | 'avif';
    quality?: number;
}

export function getAdminThumbnailUrl(
    source: string | null | undefined,
    options: AdminThumbnailOptions = {},
): string {
    if (!source || !source.trim()) return '';
    const trimmed = source.trim();

    // Check if it is a transformable Vendure asset URL (/assets/preview/ or /assets/source/)
    const assetPattern = /^(.*\/assets\/(?:preview|source)\/[^?#]+)(.*)$/;
    const match = trimmed.match(assetPattern);
    if (!match) return trimmed;

    const [_, baseUrl, queryPart] = match;
    const {
        width = 160,
        height = 160,
        preset = 'storefront-thumbnail-160',
        format = 'webp',
        quality = 80,
    } = options;

    const urlParams = new URLSearchParams(queryPart.replace(/^\?/, ''));
    if (!urlParams.has('preset') && preset) {
        urlParams.set('preset', preset);
    }
    if (!urlParams.has('format') && format) {
        urlParams.set('format', format);
    }
    if (!urlParams.has('w') && width) {
        urlParams.set('w', String(width));
    }
    if (!urlParams.has('h') && height) {
        urlParams.set('h', String(height));
    }
    if (!urlParams.has('q') && quality) {
        urlParams.set('q', String(quality));
    }

    const query = urlParams.toString();
    return query ? `${baseUrl}?${query}` : baseUrl;
}

export interface AdminImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    src?: string | null;
    thumbnailOptions?: AdminThumbnailOptions;
    fallbackIcon?: React.ReactNode;
}

export function AdminImage({
    src,
    alt = '',
    thumbnailOptions,
    fallbackIcon,
    className,
    loading = 'lazy',
    decoding = 'async',
    onError,
    ...props
}: AdminImageProps) {
    const [failed, setFailed] = useState(false);

    if (!src || failed) {
        return fallbackIcon ? <>{fallbackIcon}</> : null;
    }

    const optimizedSrc = getAdminThumbnailUrl(src, thumbnailOptions);

    return (
        <img
            {...props}
            src={optimizedSrc}
            alt={alt}
            loading={loading}
            decoding={decoding}
            className={className}
            onError={event => {
                setFailed(true);
                onError?.(event);
            }}
        />
    );
}
