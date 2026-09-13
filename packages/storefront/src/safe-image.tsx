import { Package } from 'lucide-react';
import { ImgHTMLAttributes, useLayoutEffect, useRef, useState } from 'react';

import { decodeImageElement, IMAGE_WAIT_EXPIRED_EVENT, imageCandidateIdentity } from './image-readiness';
import { imageSources, StorefrontImageKind, storefrontPlaceholderUrl } from './responsive-image';

export type SafeImageProps = {
    src: string;
    fallbackSrc?: string;
    placeholderSrc?: string;
    frameClassName?: string;
    alt: string;
    imageKind?: StorefrontImageKind;
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

function SafeImageSource({
    src,
    fallbackSrc,
    placeholderSrc,
    frameClassName,
    alt,
    imageKind,
    onLoad,
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
    const [loadedCandidate, setLoadedCandidate] = useState('');
    const imageRef = useRef<HTMLImageElement>(null);
    const active = useRef(true);
    const exceededBudget = useRef(false);
    const sources = imageSources(currentSrc, responsive ? imageKind : undefined, imageProps.sizes);
    const sourceKey = [sources.src, sources.srcSet ?? imageProps.srcSet ?? '', sources.sizes ?? ''].join(
        '\u0000',
    );
    const latestSourceKey = useRef(sourceKey);
    latestSourceKey.current = sourceKey;
    const loaded = loadedCandidate.startsWith(sourceKey + '\u0001') && !failed;
    const placeholder =
        retainedSrc ||
        (placeholderSrc && imageKind
            ? (storefrontPlaceholderUrl(placeholderSrc, imageKind) ?? placeholderSrc)
            : placeholderSrc) ||
        (imageKind === 'hero' ? sources.placeholderSrc : undefined);

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
        if (image?.complete && image.naturalWidth > 0) reveal(image);
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
                aria-hidden="true"
                style={placeholder ? { backgroundImage: `url(${JSON.stringify(placeholder)})` } : undefined}
            >
                {!placeholder && <Package />}
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
                    role={alt ? 'img' : undefined}
                    aria-label={alt || undefined}
                />
            )}
        </span>
    );
}
