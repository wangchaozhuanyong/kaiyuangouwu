import { ImageOff } from 'lucide-react';
import { ImgHTMLAttributes, useContext, useLayoutEffect, useRef, useState } from 'react';

import { decodeImageElement, IMAGE_WAIT_EXPIRED_EVENT, imageCandidateIdentity } from './image-readiness';
import { imageSources, StorefrontImageKind, storefrontPlaceholderUrl } from './responsive-image';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontLanguage } from './types';

export function ImagePlaceholder({
    state = 'missing',
    alt = '',
    compact = false,
    language,
}: {
    state?: 'missing' | 'loading' | 'error' | 'timeout';
    alt?: string;
    compact?: boolean;
    language?: StorefrontLanguage;
}) {
    const runtime = useContext(StorefrontContext);
    const isZh = (language ?? runtime?.language ?? 'zh') === 'zh';
    const loading = state === 'loading';
    const label =
        state === 'missing'
            ? isZh
                ? '暂无商品图片'
                : 'No product image'
            : isZh
              ? '图片暂时无法显示'
              : 'Image temporarily unavailable';
    return (
        <span
            className="image-placeholder image-status"
            data-image-state={state}
            role={loading ? undefined : 'img'}
            aria-label={loading ? undefined : [alt, label].filter(Boolean).join(' · ')}
            aria-hidden={loading ? true : undefined}
        >
            {loading ? (
                <span className="image-status-loading" />
            ) : (
                <span className="image-status-content" aria-hidden="true">
                    <ImageOff />
                    {!compact && <span className="image-status-label">{label}</span>}
                </span>
            )}
        </span>
    );
}

export type SafeImageProps = {
    src: string;
    fallbackSrc?: string;
    placeholderSrc?: string;
    showFallbackIcon?: boolean;
    frameClassName?: string;
    alt: string;
    imageKind?: StorefrontImageKind;
    language?: StorefrontLanguage;
    onImageReady?: (image: HTMLImageElement) => void;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'onError'>;

export function SafeImage(props: SafeImageProps) {
    const identity = [
        props.src,
        props.fallbackSrc ?? '',
        props.imageKind ?? '',
        props.srcSet ?? '',
        props.sizes ?? '',
    ].join('\u0000');
    const [previous, setPrevious] = useState({ identity: '', source: '' });
    return (
        <SafeImageSource
            key={identity}
            {...props}
            retainedSrc={previous.identity !== identity ? previous.source : ''}
            onReady={source =>
                setPrevious(current =>
                    current.identity === identity && current.source === source
                        ? current
                        : { identity, source },
                )
            }
        />
    );
}

const decodedImageUrls = new Set<string>();

export function isImageAlreadyDecoded(
    src?: string | null,
    fallbackSrc?: string | null,
    sourceKey?: string | null,
): boolean {
    if (typeof window === 'undefined') return false;
    if (src && decodedImageUrls.has(src)) return true;
    if (fallbackSrc && decodedImageUrls.has(fallbackSrc)) return true;
    if (sourceKey && decodedImageUrls.has(sourceKey)) return true;
    return false;
}

export function markImageDecoded(url?: string | null): void {
    if (url) decodedImageUrls.add(url);
}

export function clearDecodedImageCache(): void {
    decodedImageUrls.clear();
}

function SafeImageSource({
    src,
    fallbackSrc,
    placeholderSrc,
    showFallbackIcon = true,
    frameClassName,
    alt,
    imageKind,
    language,
    onLoad,
    onImageReady,
    className,
    retainedSrc,
    onReady,
    ...imageProps
}: SafeImageProps & { retainedSrc: string; onReady: (source: string) => void }) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [responsive, setResponsive] = useState(true);
    const [failed, setFailed] = useState(false);
    const [fallbackHeight, setFallbackHeight] = useState<number>();
    const [timedOut, setTimedOut] = useState(false);
    const sources = imageSources(currentSrc, responsive ? imageKind : undefined, imageProps.sizes);
    const sourceKey = [sources.src, sources.srcSet ?? imageProps.srcSet ?? '', sources.sizes ?? ''].join(
        '\u0000',
    );
    // A decoded small srcset candidate does not make a larger candidate ready.
    const initiallyDecoded =
        !sources.srcSet && !imageProps.srcSet && isImageAlreadyDecoded(sources.src, currentSrc, sourceKey);
    const [loadedCandidate, setLoadedCandidate] = useState(() =>
        initiallyDecoded ? sourceKey + '\u0001cached' : '',
    );
    const imageRef = useRef<HTMLImageElement>(null);
    const notifiedCandidate = useRef('');
    const active = useRef(true);
    const exceededBudget = useRef(false);
    const latestSourceKey = useRef(sourceKey);
    latestSourceKey.current = sourceKey;
    const loaded = loadedCandidate.startsWith(sourceKey + '\u0001') && !failed;
    const heroPlaceholder =
        imageKind === 'hero' ? imageSources(src, imageKind, imageProps.sizes).placeholderSrc : undefined;
    const placeholder =
        retainedSrc ||
        (placeholderSrc && imageKind
            ? (storefrontPlaceholderUrl(placeholderSrc, imageKind) ?? placeholderSrc)
            : placeholderSrc) ||
        heroPlaceholder;

    function useFallback() {
        if (!active.current) return;
        setLoadedCandidate('');
        if (responsive && imageKind && sources.srcSet) setResponsive(false);
        else if (fallbackSrc && currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc);
            setResponsive(false);
        } else {
            setFallbackHeight(imageRef.current?.getBoundingClientRect().height || undefined);
            setFailed(true);
        }
    }

    function reveal(image: HTMLImageElement, onDecoded?: () => void) {
        if (!image.complete || image.naturalWidth === 0) return;
        const candidate = imageCandidateIdentity(image);
        void decodeImageElement(image)
            .then(() => {
                if (
                    !active.current ||
                    imageRef.current !== image ||
                    latestSourceKey.current !== sourceKey ||
                    imageCandidateIdentity(image) !== candidate
                )
                    return;
                markImageDecoded(image.currentSrc || image.src);
                markImageDecoded(sources.src);
                markImageDecoded(currentSrc);
                markImageDecoded(sourceKey);
                markImageDecoded(candidate);
                if (notifiedCandidate.current !== candidate) {
                    notifiedCandidate.current = candidate;
                    onImageReady?.(image);
                }
                setLoadedCandidate(sourceKey + '\u0001' + candidate);
                setTimedOut(false);
                onReady(image.currentSrc || image.src);
                onDecoded?.();
            })
            .catch(() => {
                if (
                    active.current &&
                    imageRef.current === image &&
                    latestSourceKey.current === sourceKey &&
                    imageCandidateIdentity(image) === candidate
                )
                    useFallback();
            });
    }

    useLayoutEffect(() => {
        active.current = true;
        const image = imageRef.current;
        const expire = () => {
            exceededBudget.current = true;
            setTimedOut(true);
        };
        image?.addEventListener(IMAGE_WAIT_EXPIRED_EVENT, expire);
        if (image?.complete && image.naturalWidth > 0) {
            const candidate = imageCandidateIdentity(image);
            if (
                isImageAlreadyDecoded(image.currentSrc || image.src) &&
                !loadedCandidate.startsWith(sourceKey + '\u0001')
            ) {
                setLoadedCandidate(sourceKey + '\u0001' + candidate);
                setTimedOut(false);
                onReady(image.currentSrc || image.src);
            }
            reveal(image);
        }
        return () => {
            active.current = false;
            image?.removeEventListener(IMAGE_WAIT_EXPIRED_EVENT, expire);
        };
    }, [sourceKey]);

    const state = failed ? 'error' : loaded ? 'ready' : timedOut ? 'timeout' : 'loading';
    const frame = [
        'responsive-picture safe-image-frame',
        loaded && 'is-loaded',
        imageProps.fetchPriority === 'high' && !exceededBudget.current && 'is-priority',
        placeholder && 'has-placeholder',
        frameClassName,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <span
            className={frame}
            data-safe-image={state}
            style={{ minHeight: failed ? fallbackHeight : undefined }}
        >
            <span
                className="safe-image-fallback"
                aria-hidden={failed || timedOut ? undefined : true}
                style={placeholder ? { backgroundImage: `url(${JSON.stringify(placeholder)})` } : undefined}
            >
                {!placeholder && showFallbackIcon && (
                    <ImagePlaceholder
                        state={failed ? 'error' : timedOut ? 'timeout' : 'loading'}
                        alt={alt}
                        compact={imageKind === 'thumbnail' || imageKind === 'icon'}
                        language={language}
                    />
                )}
            </span>
            {!failed ? (
                <img
                    {...imageProps}
                    ref={imageRef}
                    src={sources.src}
                    srcSet={sources.srcSet ?? imageProps.srcSet}
                    sizes={sources.sizes}
                    width={imageProps.width ?? sources.width}
                    height={imageProps.height ?? sources.height}
                    alt={alt}
                    decoding={imageProps.decoding ?? 'async'}
                    className={`safe-image${loaded ? ' is-loaded' : ''}${className ? ' ' + className : ''}`}
                    onLoad={event => reveal(event.currentTarget, () => onLoad?.(event))}
                    onError={useFallback}
                />
            ) : (
                <span
                    className="safe-image-unavailable"
                    role={alt && (!showFallbackIcon || placeholder) ? 'img' : undefined}
                    aria-label={alt && (!showFallbackIcon || placeholder) ? alt : undefined}
                />
            )}
        </span>
    );
}
