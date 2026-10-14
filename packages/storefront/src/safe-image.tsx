import { ImageOff, Package } from 'lucide-react';
import {
    createContext,
    ImgHTMLAttributes,
    ReactNode,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    boundedMediaPreviews,
    type MediaDescriptor,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import {
    cancelPendingImage,
    decodeImageElement,
    IMAGE_REQUEST_TIMEOUT_MS,
    IMAGE_WAIT_EXPIRED_EVENT,
    imageCandidateIdentity,
    isImageCandidateComplete,
} from './image-readiness';
import { imageSources, StorefrontImageKind, storefrontPlaceholderUrl } from './responsive-image';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontLanguage } from './types';

/** Image accessibility uses the same language in anonymous HTML and the interactive frame. */
export const ImageLanguageContext = createContext<StorefrontLanguage | null>(null);

const SafeImageMediaContext = createContext<ReadonlyMap<string, string>>(new Map());
const mediaPreviewKey = (source: string, kind?: StorefrontImageKind) =>
    `${imageSources(source).identity}\u0000${kind ?? ''}`;

/** Consume only the current page's query-owned public hints; this provider adds no DOM. */
export function SafeImageMediaProvider({
    media = [],
    children,
}: {
    media?: readonly MediaDescriptor[];
    children: ReactNode;
}) {
    const previews = useMemo(
        () =>
            new Map(
                boundedMediaPreviews(media).flatMap(descriptor =>
                    descriptor.placeholder && imageSources(descriptor.identity).version === descriptor.version
                        ? [
                              [
                                  mediaPreviewKey(descriptor.identity, descriptor.kind),
                                  descriptor.placeholder.inlineData,
                              ] as const,
                          ]
                        : [],
                ),
            ),
        [media],
    );
    return <SafeImageMediaContext.Provider value={previews}>{children}</SafeImageMediaContext.Provider>;
}

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
    const frameLanguage = useContext(ImageLanguageContext);
    const isZh = (language ?? runtime?.language ?? frameLanguage ?? 'zh') === 'zh';
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
    /** Native art direction keeps SSR and the browser on the same image candidate. */
    mediaSources?: Array<{ media: string; src: string; sizes?: string; width?: number; height?: number }>;
    fallbackSrc?: string;
    errorFallback?: ReactNode;
    loadingFallback?: ReactNode;
    /** Private identity surfaces keep visual decode reuse inside one confirmed owner. */
    retainedOwnerKey?: string;
    placeholderSrc?: string;
    showFallbackIcon?: boolean;
    fallbackLabel?: string;
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
        props.placeholderSrc ?? '',
        props.imageKind ?? '',
        props.srcSet ?? '',
        props.sizes ?? '',
        props.retainedOwnerKey ?? '',
        JSON.stringify(props.mediaSources ?? []),
    ].join('\u0000');
    const [previous, setPrevious] = useState<{
        identity: string;
        presentation?: ImagePresentation;
        ownerKey?: string;
    }>({ identity: '', ownerKey: props.retainedOwnerKey });
    return (
        <SafeImageSource
            key={identity}
            {...props}
            retainedPresentation={
                previous.ownerKey === props.retainedOwnerKey && previous.identity !== identity
                    ? previous.presentation
                    : undefined
            }
            onPresented={presentation =>
                setPrevious(current =>
                    current.identity === identity &&
                    current.presentation?.source === presentation.source &&
                    current.presentation?.backgroundSize === presentation.backgroundSize &&
                    current.presentation?.backgroundPosition === presentation.backgroundPosition
                        ? current
                        : { identity, presentation, ownerKey: props.retainedOwnerKey },
                )
            }
        />
    );
}

const decodedImageUrls = new Set<string>();
// This is decode bookkeeping for actual image resources, never a server-data cache.
type ImagePresentation = { source: string; backgroundSize: string; backgroundPosition: string };
const decodedAvatarPreviews = new Map<string, ImagePresentation>();

function imagePresentation(image: HTMLImageElement): ImagePresentation {
    const style = getComputedStyle(image);
    const fit = style.objectFit || 'contain';
    const backgroundSize =
        fit === 'fill'
            ? '100% 100%'
            : fit === 'none'
              ? 'auto'
              : fit === 'scale-down'
                ? image.naturalWidth <= image.clientWidth && image.naturalHeight <= image.clientHeight
                    ? 'auto'
                    : 'contain'
                : fit;
    return {
        source: image.currentSrc || image.src,
        backgroundSize,
        backgroundPosition: style.objectPosition || 'center',
    };
}

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
    decodedAvatarPreviews.clear();
}

function SafeImageSource({
    src,
    mediaSources,
    fallbackSrc,
    errorFallback,
    loadingFallback,
    retainedOwnerKey,
    placeholderSrc,
    showFallbackIcon = true,
    fallbackLabel,
    frameClassName,
    alt,
    imageKind,
    language,
    onLoad,
    onImageReady,
    className,
    retainedPresentation,
    onPresented,
    ...imageProps
}: SafeImageProps & {
    retainedPresentation?: ImagePresentation;
    onPresented: (presentation: ImagePresentation) => void;
}) {
    const [currentSrc, setCurrentSrc] = useState(src);
    const [responsive, setResponsive] = useState(true);
    const [failed, setFailed] = useState(false);
    const [fallbackHeight, setFallbackHeight] = useState<number>();
    const [timedOut, setTimedOut] = useState(false);
    const [nearViewport, setNearViewport] = useState(false);
    const publicPreviews = useContext(SafeImageMediaContext);
    const inlinePreview =
        imageProps.fetchPriority === 'high' ? publicPreviews.get(mediaPreviewKey(src, imageKind)) : undefined;
    const avatarKey = JSON.stringify([retainedOwnerKey, mediaPreviewKey(src, imageKind)]);
    const decodedAvatarPreview =
        loadingFallback && retainedOwnerKey ? decodedAvatarPreviews.get(avatarKey) : undefined;
    const retainedPreview = retainedPresentation || decodedAvatarPreview;
    const [previewReady, setPreviewReady] = useState(Boolean(inlinePreview));
    const previewRef = useRef<HTMLImageElement>(null);
    const sources = imageSources(currentSrc, responsive ? imageKind : undefined, imageProps.sizes);
    const sourceKey = [
        sources.src,
        sources.srcSet ?? imageProps.srcSet ?? '',
        sources.sizes ?? '',
        JSON.stringify(mediaSources ?? []),
    ].join('\u0000');
    // A previous URL decode cannot prove that this DOM node's selected candidate is ready.
    const [loadedCandidate, setLoadedCandidate] = useState('');
    const [presentedCandidate, setPresentedCandidate] = useState('');
    const imageRef = useRef<HTMLImageElement>(null);
    const notifiedCandidate = useRef('');
    const active = useRef(true);
    const exceededBudget = useRef(false);
    const latestSourceKey = useRef(sourceKey);
    latestSourceKey.current = sourceKey;
    const nodeCandidate = imageRef.current && imageCandidateIdentity(imageRef.current);
    const candidateComplete = imageRef.current && isImageCandidateComplete(imageRef.current);
    const loaded = Boolean(
        candidateComplete && loadedCandidate === sourceKey + '\u0001' + nodeCandidate && !failed,
    );
    const presented = Boolean(
        candidateComplete && presentedCandidate === sourceKey + '\u0001' + nodeCandidate && !failed,
    );
    const placeholder =
        retainedPreview?.source ||
        inlinePreview ||
        (placeholderSrc && imageKind
            ? (storefrontPlaceholderUrl(placeholderSrc, imageKind) ?? placeholderSrc)
            : placeholderSrc);

    useLayoutEffect(() => {
        const preview = previewRef.current;
        if (preview?.complete && preview.naturalWidth > 0) setPreviewReady(true);
    }, [placeholder]);

    function useFallback() {
        if (!active.current) return;
        setLoadedCandidate('');
        setPresentedCandidate('');
        const selected = mediaSources?.find(source => window.matchMedia(source.media).matches);
        const recovery =
            selected && responsive
                ? imageSources(selected.src, imageKind, selected.sizes).recoverySrc
                : sources.recoverySrc;
        const failedUrl = imageRef.current?.currentSrc || imageRef.current?.src;
        const fallback = fallbackSrc ? imageSources(fallbackSrc, imageKind, imageProps.sizes) : undefined;
        const fallbackUrl = fallback?.recoverySrc ?? fallback?.src;
        if (responsive && recovery && new URL(recovery, window.location.href).href !== failedUrl) {
            setCurrentSrc(recovery);
            setResponsive(false);
        } else if (fallbackUrl && currentSrc !== fallbackUrl) {
            setCurrentSrc(fallbackUrl);
            setResponsive(false);
        } else {
            setFallbackHeight(imageRef.current?.getBoundingClientRect().height || undefined);
            setFailed(true);
        }
    }

    function reveal(image: HTMLImageElement, onDecoded?: () => void) {
        if (imageRef.current !== image || !isImageCandidateComplete(image)) return;
        const candidate = imageCandidateIdentity(image);
        // Native media can already be painted before decode() settles, including
        // SSR images. Retain that actual candidate if the next render changes its
        // source; presentation reuse must not mark the replacement decoded/ready.
        setPresentedCandidate(sourceKey + '\u0001' + candidate);
        setTimedOut(false);
        onPresented(imagePresentation(image));
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
                if (!mediaSources?.length && !sources.srcSet && !imageProps.srcSet) {
                    markImageDecoded(sources.src);
                    markImageDecoded(currentSrc);
                    markImageDecoded(sourceKey);
                }
                markImageDecoded(candidate);
                if (loadingFallback && retainedOwnerKey) {
                    decodedAvatarPreviews.delete(avatarKey);
                    decodedAvatarPreviews.set(avatarKey, imagePresentation(image));
                    if (decodedAvatarPreviews.size > 128) {
                        const oldest = decodedAvatarPreviews.keys().next().value;
                        if (oldest !== undefined) decodedAvatarPreviews.delete(oldest);
                    }
                }
                if (notifiedCandidate.current !== candidate) {
                    notifiedCandidate.current = candidate;
                    onImageReady?.(image);
                }
                setLoadedCandidate(sourceKey + '\u0001' + candidate);
                setTimedOut(false);
                onPresented(imagePresentation(image));
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
        let requestTimer: number | undefined;
        let cancelTimer: number | undefined;
        const clearRequestTimer = () => {
            window.clearTimeout(requestTimer);
            window.clearTimeout(cancelTimer);
        };
        const boundRequest = () => {
            if (!image || image.complete || requestTimer !== undefined) return;
            requestTimer = window.setTimeout(() => {
                if (!active.current || imageRef.current !== image || image.complete) return;
                exceededBudget.current = true;
                setFallbackHeight(image.getBoundingClientRect().height || undefined);
                setTimedOut(true);
                // A late response may still recover this local image without restarting page loading.
                cancelTimer = window.setTimeout(() => {
                    if (!active.current || imageRef.current !== image || image.complete) return;
                    cancelPendingImage(image);
                    setFailed(true);
                }, IMAGE_REQUEST_TIMEOUT_MS);
            }, IMAGE_REQUEST_TIMEOUT_MS);
        };
        const expire = () => {
            exceededBudget.current = true;
            setTimedOut(true);
            boundRequest();
        };
        image?.addEventListener(IMAGE_WAIT_EXPIRED_EVENT, expire);
        image?.addEventListener('load', clearRequestTimer);
        image?.addEventListener('error', clearRequestTimer);
        // Start fetching near-screen images before they scroll into view; geometry is unchanged.
        let observer: IntersectionObserver | undefined;
        if (image?.getAttribute('loading') !== 'lazy') boundRequest();
        else if (image && typeof IntersectionObserver !== 'undefined') {
            observer = new IntersectionObserver(
                entries => {
                    if (entries.some(entry => entry.isIntersecting)) {
                        setNearViewport(true);
                        boundRequest();
                        observer?.disconnect();
                    }
                },
                { rootMargin: '400px 0px' },
            );
            observer.observe(image);
        }
        if (image?.complete && image.naturalWidth > 0) {
            reveal(image);
        }
        return () => {
            active.current = false;
            clearRequestTimer();
            observer?.disconnect();
            image?.removeEventListener(IMAGE_WAIT_EXPIRED_EVENT, expire);
            image?.removeEventListener('load', clearRequestTimer);
            image?.removeEventListener('error', clearRequestTimer);
        };
    }, [sourceKey]);

    const state = failed
        ? timedOut
            ? 'timeout'
            : 'error'
        : loaded
          ? 'ready'
          : timedOut
            ? 'timeout'
            : 'loading';
    const frame = [
        'responsive-picture safe-image-frame',
        loaded && 'is-loaded',
        presented && 'is-presented',
        imageProps.fetchPriority === 'high' && !exceededBudget.current && 'is-priority',
        placeholder && 'has-placeholder',
        inlinePreview && 'has-inline-preview',
        frameClassName,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <span
            className={frame}
            data-safe-image={state}
            data-safe-image-recovered={failed && errorFallback != null ? 'true' : undefined}
            style={{ minHeight: failed ? fallbackHeight : undefined }}
        >
            {!failed ? (
                <SafeImageElement mediaSources={responsive ? mediaSources : undefined} imageKind={imageKind}>
                    <img
                        {...imageProps}
                        loading={nearViewport ? 'eager' : imageProps.loading}
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
                </SafeImageElement>
            ) : (
                <span
                    className="safe-image-unavailable"
                    role={alt && (fallbackLabel || !showFallbackIcon || placeholder) ? 'img' : undefined}
                    aria-label={alt ? [alt, fallbackLabel].filter(Boolean).join(' · ') : undefined}
                />
            )}
            <span
                className="safe-image-fallback"
                aria-hidden={failed ? undefined : true}
                style={
                    !failed && retainedPreview
                        ? {
                              backgroundImage: `url(${JSON.stringify(retainedPreview.source)})`,
                              backgroundSize: retainedPreview.backgroundSize,
                              backgroundPosition: retainedPreview.backgroundPosition,
                          }
                        : undefined
                }
            >
                {!failed && loadingFallback && !placeholder ? (
                    loadingFallback
                ) : !failed && placeholder && !retainedPreview ? (
                    <>
                        {!previewReady && (
                            <span className="safe-image-preview-loading" aria-hidden="true">
                                <span className="page-loading-spinner" />
                            </span>
                        )}
                        <img
                            ref={previewRef}
                            className={`safe-image-preview${previewReady ? ' is-ready' : ''}`}
                            src={placeholder}
                            alt=""
                            aria-hidden="true"
                            loading={imageProps.loading === 'lazy' ? 'lazy' : 'eager'}
                            decoding="async"
                            fetchPriority="auto"
                            onLoad={() => setPreviewReady(true)}
                        />
                    </>
                ) : failed && errorFallback != null ? (
                    errorFallback
                ) : failed && fallbackLabel ? (
                    <span className="product-image-placeholder-copy">
                        {showFallbackIcon && <Package />}
                        <span className="product-image-placeholder-label">{fallbackLabel}</span>
                    </span>
                ) : (
                    (!placeholder || failed) &&
                    showFallbackIcon && (
                        <ImagePlaceholder
                            state={timedOut ? 'timeout' : failed ? 'error' : 'loading'}
                            alt={alt}
                            compact={imageKind === 'thumbnail' || imageKind === 'icon'}
                            language={language}
                        />
                    )
                )}
            </span>
        </span>
    );
}

/** A picture adds no layout box; all geometry remains owned by the existing media frame. */
function SafeImageElement({
    children,
    mediaSources,
    imageKind,
}: {
    children: ReactNode;
    mediaSources: SafeImageProps['mediaSources'];
    imageKind?: StorefrontImageKind;
}) {
    if (!mediaSources?.length) return <>{children}</>;
    return (
        <picture className="safe-image-art-direction">
            {mediaSources.map(source => {
                const descriptor = imageSources(source.src, imageKind, source.sizes);
                return (
                    <source
                        key={source.media}
                        media={source.media}
                        srcSet={descriptor.srcSet ?? descriptor.src}
                        sizes={descriptor.sizes}
                        width={source.width}
                        height={source.height}
                    />
                );
            })}
            {children}
        </picture>
    );
}
