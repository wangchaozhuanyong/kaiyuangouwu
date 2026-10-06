import React, { type ImgHTMLAttributes, useMemo, useState } from 'react';
import {
    mediaDescriptor,
    type StorefrontImageKind,
} from '../../../storefront-content-plugin/src/shared/responsive-image';

export function getAdminThumbnailUrl(source: string | null | undefined): string {
    return source?.trim() ? mediaDescriptor(source, 'thumbnail').src : '';
}

export interface AdminImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
    src?: string | null;
    mediaKind?: StorefrontImageKind;
    fallbackIcon?: React.ReactNode;
}

/** Admin and storefront images share asset identity, content version and responsive derivatives. */
export function AdminImage({
    src,
    alt = '',
    mediaKind = 'thumbnail',
    fallbackIcon,
    className,
    loading = 'lazy',
    decoding = 'async',
    onError,
    sizes,
    width,
    height,
    srcSet,
    ...props
}: AdminImageProps) {
    const media = useMemo(() => mediaDescriptor(src ?? '', mediaKind, { sizes }), [src, mediaKind, sizes]);
    const [failedSource, setFailedSource] = useState<string>();
    if (!media.src || failedSource === media.src) return fallbackIcon ? <>{fallbackIcon}</> : null;
    return (
        <img
            {...props}
            src={media.src}
            srcSet={srcSet ?? media.srcSet}
            sizes={media.sizes}
            width={width ?? media.width}
            height={height ?? media.height}
            alt={alt}
            loading={loading}
            decoding={decoding}
            className={className}
            onError={event => {
                setFailedSource(media.src);
                onError?.(event);
            }}
        />
    );
}
