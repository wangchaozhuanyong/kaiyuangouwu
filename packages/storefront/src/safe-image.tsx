import { ImageOff, Package } from 'lucide-react';
import {
    createContext,
    CSSProperties,
    ImgHTMLAttributes,
    lazy,
    ReactNode,
    Suspense,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import {
    boundedMediaPreviews,
    validInlineImagePreview,
    type MediaDescriptor,
} from '../../storefront-content-plugin/src/shared/responsive-image';

import {
    cancelPendingImage,
    decodeImageElement,
    IMAGE_REQUEST_TIMEOUT_MS,
    IMAGE_WAIT_EXPIRED_EVENT,
    imageCandidateIdentity,
    isFirstViewportElement,
    isImageCandidateComplete,
} from './image-readiness';
import { imageSources, StorefrontImageKind, storefrontPlaceholderUrl } from './responsive-image';
import { StorefrontContext } from './StorefrontContext';
import { StorefrontLanguage } from './types';

/** Image accessibility uses the same language in anonymous HTML and the interactive frame. */
export const ImageLanguageContext = createContext<StorefrontLanguage | null>(null);

export const SafeImageMediaContext = createContext<{
    previews: ReadonlyMap<string, string>;
    sources: ReadonlySet<string>;
    scope?: string;
    borrowedSources?: ReadonlySet<string>;
    borrowedGeneration?: number;
}>({ previews: new Map(), sources: new Set() });
export type BorrowedPublicMedia = { media: readonly MediaDescriptor[]; generation: number };
const mediaPreviewKey = (source: string, kind?: StorefrontImageKind) =>
    `${imageSources(source).identity}\u0000${kind ?? ''}`;

/** Consume only the current page's query-owned public hints; this provider adds no DOM. */
export function SafeImageMediaProvider({
    media = [],
    scope,
    children,
}: {
    media?: readonly MediaDescriptor[];
    scope?: string;
    children: ReactNode;
}) {
    const value = useMemo(() => {
        const sources = new Set<string>();
        const previews = new Map<string, string>();
        for (const descriptor of boundedMediaPreviews(media)) {
            if (imageSources(descriptor.identity).version !== descriptor.version) continue;
            const key = mediaPreviewKey(descriptor.identity, descriptor.kind);
            sources.add(key);
            if (descriptor.placeholder) previews.set(key, descriptor.placeholder.inlineData);
        }
        return { scope, sources, previews };
    }, [media, scope]);
    return <SafeImageMediaContext.Provider value={value}>{children}</SafeImageMediaContext.Provider>;
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

type PreviewSourceDimensions = { width?: number; height?: number };

export type SafeImageProps = {
    src: string;
    /** Actual source pixels, never a responsive preset or CSS display size. */
    previewSourceDimensions?: PreviewSourceDimensions | null;
    /** Native art direction keeps SSR and the browser on the same image candidate. */
    mediaSources?: Array<{
        media: string;
        src: string;
        sizes?: string;
        width?: number;
        height?: number;
        previewSourceDimensions?: PreviewSourceDimensions | null;
    }>;
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
    const { scope, borrowedSources, borrowedGeneration } = useContext(SafeImageMediaContext);
    const borrowedOwner =
        !props.retainedOwnerKey && borrowedSources?.has(mediaPreviewKey(props.src, props.imageKind))
            ? borrowedGeneration
            : undefined;
    const ownerKey = JSON.stringify([
        scope,
        props.retainedOwnerKey,
        ...(borrowedOwner === undefined ? [] : [borrowedOwner]),
    ]);
    const identity = [
        props.src,
        props.fallbackSrc,
        props.placeholderSrc,
        props.imageKind,
        props.srcSet,
        props.sizes,
        props.retainedOwnerKey,
        scope,
        borrowedOwner,
        JSON.stringify(props.mediaSources ?? []),
    ].join('\u0000');
    const [previous, setPrevious] = useState<{
        identity: string;
        presentation?: ImagePresentation;
        ownerKey?: string;
    }>({ identity: '', ownerKey });
    return (
        <SafeImageSource
            key={identity}
            {...props}
            retainedPresentation={
                previous.ownerKey === ownerKey && previous.identity !== identity
                    ? previous.presentation
                    : undefined
            }
            onPresented={presentation =>
                setPrevious(current =>
                    current.identity === identity &&
                    current.presentation?.source === presentation.source &&
                    current.presentation?.size === presentation.size &&
                    current.presentation?.position === presentation.position
                        ? current
                        : { identity, presentation, ownerKey },
                )
            }
        />
    );
}

const decodedImageUrls = new Set<string>();
// This is decode bookkeeping for actual image resources, never a server-data cache.
type ImagePresentation = { source: string; size: string; position: string };
const decodedImagePreviews = new Map<string, ImagePresentation>();
const ImageRecovery = lazy(() => import('./image-recovery').catch(() => ({ default: () => <></> })));

function rememberImagePresentation(key: string | undefined, presentation: ImagePresentation) {
    if (!key) return;
    decodedImagePreviews.delete(key);
    decodedImagePreviews.set(key, presentation);
    if (decodedImagePreviews.size > 128) {
        const oldest = decodedImagePreviews.keys().next().value;
        if (oldest !== undefined) decodedImagePreviews.delete(oldest);
    }
}

function imageFrameCrop(image: HTMLImageElement) {
    const style = getComputedStyle(image);
    const fit = style.objectFit || 'contain';
    const size =
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
        size,
        position: style.objectPosition || 'center',
        objectFit: fit as CSSProperties['objectFit'],
    };
}

function imagePresentation(image: HTMLImageElement): ImagePresentation {
    const { size, position } = imageFrameCrop(image);
    return { source: image.currentSrc || image.src, size, position };
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
    decodedImagePreviews.clear();
}

function SafeImageSource({
    src,
    previewSourceDimensions,
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
    loading,
    fetchPriority,
    srcSet,
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
    const [requestAttempt, setRequestAttempt] = useState(0);
    const retryState = useRef({ onlineRetried: false, nextManualAt: 0 });
    const frameRef = useRef<HTMLSpanElement>(null);
    const publicMedia = useContext(SafeImageMediaContext);
    // Parent admission already checked the owner; keep this handoff until this node paints.
    const replacementPresentation = useRef(retainedPresentation).current;
    function inlinePreviewFor(source: string, dimensions?: PreviewSourceDimensions | null) {
        const preview = publicMedia.previews.get(mediaPreviewKey(source, imageKind));
        const { width = 0, height = 0 } = dimensions ?? {};
        if (
            !validInlineImagePreview(preview) ||
            ![width, height].every(value => Number.isSafeInteger(value) && value > 0)
        )
            return preview;
        // Only this fixed template and an already-bounded raster enter the generated image.
        // The public hint validator continues to reject SVG and external resources.
        const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            `<image width="${width}" height="${height}" preserveAspectRatio="none" href="${preview}"/></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
    const inlinePreview = inlinePreviewFor(src, previewSourceDimensions);
    const inlineMediaSources = mediaSources?.flatMap(source => {
        const preview = inlinePreviewFor(source.src, source.previewSourceDimensions);
        return preview ? [{ media: source.media, src: preview }] : [];
    });
    const hasInlinePreview = Boolean(inlinePreview || inlineMediaSources?.length);
    const currentArtworkSource = () =>
        mediaSources?.find(
            source => typeof window !== 'undefined' && window.matchMedia?.(source.media).matches,
        );
    const currentArtworkKey = () => mediaPreviewKey(currentArtworkSource()?.src ?? src, imageKind);
    const artworkSource = currentArtworkSource();
    const artworkInlinePreview = artworkSource
        ? inlinePreviewFor(artworkSource.src, artworkSource.previewSourceDimensions)
        : inlinePreview;
    // Reuse published resources only in the confirmed public scope, or for an explicit private owner.
    // This extends decoded-resource bookkeeping; it stores no response data or pixel copies.
    const presentationCacheKey = () => {
        const key = currentArtworkKey();
        return retainedOwnerKey
            ? JSON.stringify(['owner', publicMedia.scope, retainedOwnerKey, key])
            : publicMedia.scope && publicMedia.sources.has(key)
              ? JSON.stringify([
                    'public',
                    publicMedia.scope,
                    key,
                    srcSet ?? '',
                    ...(publicMedia.borrowedSources?.has(key) ? [publicMedia.borrowedGeneration] : []),
                ])
              : undefined;
    };
    const presentationKey = presentationCacheKey();
    const retainedPreview =
        replacementPresentation || (presentationKey ? decodedImagePreviews.get(presentationKey) : undefined);
    const [previewReady, setPreviewReady] = useState(hasInlinePreview);
    const [frameCrop, setFrameCrop] = useState<ReturnType<typeof imageFrameCrop>>();
    const [, setArtworkRevision] = useState(0);
    const previewRef = useRef<HTMLImageElement>(null);
    const sources = imageSources(currentSrc, responsive ? imageKind : undefined, imageProps.sizes);
    const sourceKey = [
        sources.src,
        sources.srcSet ?? srcSet,
        sources.sizes,
        JSON.stringify(mediaSources ?? []),
    ].join('\u0000');
    // A previous URL decode cannot prove that this DOM node's selected candidate is ready.
    const [loadedCandidate, setLoadedCandidate] = useState('');
    const [presentedCandidate, setPresentedCandidate] = useState('');
    const [paintedCandidate, setPaintedCandidate] = useState('');
    const handoffFrames = useRef<number[]>([]);
    const imageRef = useRef<HTMLImageElement>(null);
    const notifiedCandidate = useRef('');
    const active = useRef(true);
    const retrying = useRef(false);
    const exceededBudget = useRef(false);
    const latestSourceKey = useRef(sourceKey);
    latestSourceKey.current = sourceKey;
    const nodeCandidate = imageRef.current && imageCandidateIdentity(imageRef.current);
    const nodeKey = sourceKey + '\u0001' + nodeCandidate;
    const candidateComplete = imageRef.current && isImageCandidateComplete(imageRef.current);
    const loaded = Boolean(candidateComplete && loadedCandidate === nodeKey && !failed);
    const presented = Boolean(candidateComplete && presentedCandidate === nodeKey && !failed);
    const painted = presented && paintedCandidate === nodeKey;
    const placeholder =
        retainedPreview?.source ||
        inlinePreview ||
        (placeholderSrc && imageKind
            ? (storefrontPlaceholderUrl(placeholderSrc, imageKind) ?? placeholderSrc)
            : placeholderSrc);
    const hasPreview = Boolean(placeholder || inlineMediaSources?.length);

    function retryImage() {
        if (!active.current || !failed || retrying.current) return;
        retrying.current = true;
        setCurrentSrc(src);
        setResponsive(true);
        setFailed(false);
        setTimedOut(false);
        setLoadedCandidate('');
        setPresentedCandidate('');
        setPaintedCandidate('');
        notifiedCandidate.current = '';
        exceededBudget.current = false;
        setRequestAttempt(current => current + 1);
    }

    useLayoutEffect(() => {
        const image = imageRef.current;
        if (!image || !hasPreview) return;
        const measure = () => {
            const next = imageFrameCrop(image);
            setFrameCrop(current =>
                current?.size === next.size &&
                current.position === next.position &&
                current.objectFit === next.objectFit
                    ? current
                    : next,
            );
        };
        measure();
        // Cached pixels belong to an artwork, while the current frame owns its crop.
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
        observer?.observe(image);
        const queries = mediaSources?.map(source => window.matchMedia?.(source.media)).filter(Boolean) ?? [];
        let selectedArtwork = currentArtworkKey();
        const change = () => {
            measure();
            const nextArtwork = currentArtworkKey();
            if (nextArtwork !== selectedArtwork) setPaintedCandidate('');
            selectedArtwork = nextArtwork;
            setArtworkRevision(current => current + 1);
        };
        queries.forEach(query => query?.addEventListener?.('change', change));
        return () => {
            observer?.disconnect();
            queries.forEach(query => query?.removeEventListener?.('change', change));
        };
    }, [sourceKey, className, imageProps.style, hasPreview]);

    useLayoutEffect(() => {
        const preview = previewRef.current;
        if (preview?.complete && preview.naturalWidth > 0) setPreviewReady(true);
    }, [placeholder]);

    function useFallback() {
        if (!active.current) return;
        retrying.current = false;
        setLoadedCandidate('');
        setPresentedCandidate('');
        setPaintedCandidate('');
        const selected = currentArtworkSource();
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
        const candidateKey = sourceKey + '\u0001' + candidate;
        const isCurrentCandidate = () =>
            active.current &&
            imageRef.current === image &&
            latestSourceKey.current === sourceKey &&
            imageCandidateIdentity(image) === candidate;
        // Native media can already be painted before decode() settles, including
        // SSR images. Retain that actual candidate if the next render changes its
        // source; presentation reuse must not mark the replacement decoded/ready.
        setPresentedCandidate(candidateKey);
        setTimedOut(false);
        onPresented(imagePresentation(image));
        cancelHandoffFrames();
        void decodeImageElement(image)
            .then(() => {
                if (!isCurrentCandidate()) return;
                // A load event and elapsed frames cannot prove a new node is decoded.
                // Keep its backing until this candidate can paint, without hiding native SSR media.
                cancelHandoffFrames();
                if (typeof window.requestAnimationFrame === 'function') {
                    handoffFrames.current.push(
                        window.requestAnimationFrame(() => {
                            handoffFrames.current.push(
                                window.requestAnimationFrame(() => {
                                    if (isCurrentCandidate()) setPaintedCandidate(candidateKey);
                                }),
                            );
                        }),
                    );
                } else setPaintedCandidate(candidateKey);
                markImageDecoded(image.currentSrc || image.src);
                if (!mediaSources?.length && !sources.srcSet && !srcSet) {
                    markImageDecoded(sources.src);
                    markImageDecoded(currentSrc);
                    markImageDecoded(sourceKey);
                }
                markImageDecoded(candidate);
                rememberImagePresentation(presentationCacheKey(), imagePresentation(image));
                if (notifiedCandidate.current !== candidate) {
                    notifiedCandidate.current = candidate;
                    onImageReady?.(image);
                }
                setLoadedCandidate(candidateKey);
                setTimedOut(false);
                onPresented(imagePresentation(image));
                onDecoded?.();
            })
            .catch(() => {
                if (isCurrentCandidate()) useFallback();
            });
    }

    function cancelHandoffFrames() {
        handoffFrames.current.forEach(frameId => window.cancelAnimationFrame(frameId));
        handoffFrames.current = [];
    }

    useLayoutEffect(() => {
        active.current = true;
        retrying.current = false;
        const image = imageRef.current;
        if (
            image &&
            fetchPriority !== 'low' &&
            (imageKind === 'hero' || imageKind === 'detail') &&
            isFirstViewportElement(image, image.closest('.storefront-app') ?? document.body)
        ) {
            image.fetchPriority = 'high';
            setNearViewport(true);
        }
        let requestTimer: number | undefined;
        let cancelTimer: number | undefined;
        const clearRequestTimer = () => {
            window.clearTimeout(requestTimer);
            window.clearTimeout(cancelTimer);
        };
        const boundRequest = () => {
            if (!image || image.complete || requestTimer !== undefined) return;
            const isPending = () => active.current && imageRef.current === image && !image.complete;
            requestTimer = window.setTimeout(() => {
                if (!isPending()) return;
                exceededBudget.current = true;
                setFallbackHeight(image.getBoundingClientRect().height || undefined);
                setTimedOut(true);
                // A late response may still recover this local image without restarting page loading.
                cancelTimer = window.setTimeout(() => {
                    if (!isPending()) return;
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
        if (image?.complete) {
            if (image.naturalWidth > 0) reveal(image);
            else useFallback();
        }
        return () => {
            active.current = false;
            cancelHandoffFrames();
            clearRequestTimer();
            observer?.disconnect();
            image?.removeEventListener(IMAGE_WAIT_EXPIRED_EVENT, expire);
            image?.removeEventListener('load', clearRequestTimer);
            image?.removeEventListener('error', clearRequestTimer);
        };
    }, [sourceKey, requestAttempt]);

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
        painted && 'is-painted',
        fetchPriority === 'high' && !exceededBudget.current && 'is-priority',
        hasPreview && 'has-placeholder',
        hasInlinePreview && 'has-inline-preview',
        frameClassName,
    ]
        .filter(Boolean)
        .join(' ');
    return (
        <span
            ref={frameRef}
            className={frame}
            data-safe-image={state}
            data-safe-image-recovered={failed && errorFallback != null ? 'true' : undefined}
            style={{ minHeight: failed ? fallbackHeight : undefined }}
        >
            {!failed ? (
                <SafeImageElement mediaSources={responsive ? mediaSources : undefined} imageKind={imageKind}>
                    <img
                        {...imageProps}
                        fetchPriority={fetchPriority}
                        loading={nearViewport ? 'eager' : loading}
                        ref={imageRef}
                        src={sources.src}
                        srcSet={sources.srcSet ?? srcSet}
                        sizes={sources.sizes}
                        width={imageProps.width ?? sources.width}
                        height={imageProps.height ?? sources.height}
                        alt={alt}
                        decoding={
                            imageProps.decoding ??
                            (fetchPriority === 'high' && loading !== 'lazy' ? 'sync' : 'async')
                        }
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
                              backgroundImage: [retainedPreview.source, artworkInlinePreview]
                                  .filter(Boolean)
                                  .map(source => `url(${JSON.stringify(source)})`)
                                  .join(', '),
                              backgroundSize: (replacementPresentation ?? frameCrop ?? retainedPreview).size,
                              backgroundPosition: (replacementPresentation ?? frameCrop ?? retainedPreview)
                                  .position,
                          }
                        : undefined
                }
            >
                {!failed && loadingFallback && !hasPreview ? (
                    loadingFallback
                ) : !failed && hasPreview && !retainedPreview ? (
                    <>
                        {!previewReady && (
                            <span className="safe-image-preview-loading" aria-hidden="true">
                                <span className="page-loading-spinner" />
                            </span>
                        )}
                        <SafeImageElement mediaSources={inlineMediaSources}>
                            <img
                                ref={previewRef}
                                className={`safe-image-preview${previewReady ? ' is-ready' : ''}`}
                                style={
                                    frameCrop && {
                                        objectFit: frameCrop.objectFit,
                                        objectPosition: frameCrop.position,
                                    }
                                }
                                src={placeholder}
                                alt=""
                                aria-hidden="true"
                                loading={!hasInlinePreview && loading === 'lazy' ? 'lazy' : 'eager'}
                                decoding={hasInlinePreview ? 'sync' : 'async'}
                                fetchPriority="auto"
                                onLoad={() => setPreviewReady(true)}
                            />
                        </SafeImageElement>
                    </>
                ) : failed && errorFallback != null ? (
                    errorFallback
                ) : failed && fallbackLabel ? (
                    <span className="product-image-placeholder-copy">
                        {showFallbackIcon && <Package />}
                        <span className="product-image-placeholder-label">{fallbackLabel}</span>
                    </span>
                ) : (
                    (!hasPreview || failed) &&
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
            {failed && imageProps['aria-hidden'] !== true && imageProps['aria-hidden'] !== 'true' && (
                <Suspense fallback={null}>
                    <ImageRecovery
                        frame={frameRef.current}
                        state={retryState.current}
                        alt={alt}
                        language={language}
                        onRetry={retryImage}
                    />
                </Suspense>
            )}
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
    if (!mediaSources?.length) return children;
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
