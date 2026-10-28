import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEventHandler,
    type ReactNode,
} from 'react';

import { normalizedHeroThemePreset } from '../content-visuals';

import { ContentText } from './content-text';
import { heroThemeStyle, type HeroThemeData } from './hero-theme';
import { sampleImageTone, type ImageTone } from './image-tone';

export const heroArtworkLayouts = [
    { value: 'overlay', label: '原图文字覆盖' },
    { value: 'editorial', label: '图文分离' },
    { value: 'campaign', label: '固定广告框架，短文案覆盖' },
] as const;

export type HeroArtworkLayout = (typeof heroArtworkLayouts)[number]['value'];

export function resolveHeroArtworkLayout(
    settings: Record<string, unknown> | null | undefined,
): HeroArtworkLayout {
    return settings?.heroArtworkLayout === 'campaign'
        ? 'campaign'
        : settings?.heroArtworkLayout === 'editorial'
          ? 'editorial'
          : 'overlay';
}

export interface HeroSceneData extends HeroThemeData {
    title: string;
    subtitle: string;
    body: string;
    ctaLabel: string;
    targetType: string;
    imageUrl?: string | null;
    items: Array<{ label: string; description: string; enabled?: boolean }>;
}

/** The carousel and its draft preview share unaltered artwork and managed copy colors. */
export function HeroScene({
    content,
    mobileContent,
    image,
    mediaOverlay,
    copyScrollable = false,
    imageLabel,
    onImageOpen,
    onOpen,
}: {
    content: HeroSceneData;
    /** Both copy variants share one native picture; CSS selects before hydration. */
    mobileContent?: HeroSceneData;
    image: ReactNode;
    mediaOverlay?: ReactNode;
    copyScrollable?: boolean;
    imageLabel: string;
    onImageOpen?: MouseEventHandler<HTMLButtonElement>;
    onOpen?: () => void;
}) {
    const preset = normalizedHeroThemePreset(content.settings?.themePreset);
    const warm = preset === 'warm';
    const artworkLayout = resolveHeroArtworkLayout(content.settings);
    const [sampledTone, setSampledTone] = useState<{ imageUrl: typeof content.imageUrl; tone: ImageTone }>();
    // Overlaid copy uses the published theme from the first HTML. Sampling a
    // photograph after hydration must not repaint already-visible text.
    const imageTone =
        artworkLayout === 'editorial'
            ? sampledTone?.imageUrl === content.imageUrl
                ? sampledTone?.tone
                : undefined
            : preset === 'bright'
              ? 'light'
              : 'dark';
    const adaptiveStyle = heroThemeStyle(content, imageTone);
    const sampledSource = useRef('');
    const mediaRef = useRef<HTMLDivElement>(null);
    const [overlayHeight, setOverlayHeight] = useState<number>();
    const overlayMeasurement = useRef<{ elements: Element[]; observer: ResizeObserver } | null>(null);
    const responsiveCopy =
        mobileContent &&
        ((['title', 'subtitle', 'body', 'ctaLabel', 'textColor'] as const).some(
            field => mobileContent[field] !== content[field],
        ) ||
            mobileContent.items.length !== content.items.length ||
            mobileContent.settings?.secondaryTextColor !== content.settings?.secondaryTextColor);
    const copyVariants = responsiveCopy && mobileContent ? [content, mobileContent] : [content];

    const sampleRenderedImage = useCallback(
        (artworkElement: HTMLImageElement) => {
            if (
                artworkLayout !== 'editorial' ||
                !artworkElement.complete ||
                !artworkElement.naturalWidth ||
                artworkElement.getAttribute('aria-hidden') === 'true' ||
                !mediaRef.current?.querySelector('.hero-rich-image-link')?.contains(artworkElement)
            )
                return;
            const source = `${content.imageUrl ?? ''}\u0000${artworkElement.currentSrc || artworkElement.src}`;
            if (sampledSource.current === source) return;
            sampledSource.current = source;
            setSampledTone({ imageUrl: content.imageUrl, tone: sampleImageTone(artworkElement) });
        },
        [content.imageUrl, artworkLayout],
    );

    useLayoutEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const artworkElement = media.querySelector<HTMLImageElement>(
            '.hero-rich-image-link img:not([aria-hidden="true"])',
        );
        if (artworkElement) sampleRenderedImage(artworkElement);
    }, [sampleRenderedImage]);

    // React nodes change on every drag frame; only a changed DOM host needs a new observer.
    useLayoutEffect(() => {
        const elements = Array.from(mediaRef.current?.children ?? []).slice(1);
        const previous = overlayMeasurement.current;
        if (
            previous &&
            elements.length === previous.elements.length &&
            elements.every((element, index) => element === previous.elements[index])
        )
            return;
        previous?.observer.disconnect();
        const measure = () => {
            setOverlayHeight(Math.max(0, ...elements.map(element => element.getBoundingClientRect().height)));
        };
        const observer = new ResizeObserver(measure);
        elements.forEach(element => observer.observe(element));
        overlayMeasurement.current = { elements, observer };
        measure();
    });
    useLayoutEffect(
        () => () => {
            overlayMeasurement.current?.observer.disconnect();
            overlayMeasurement.current = null;
        },
        [],
    );

    return (
        <div
            className={`hero-scene-wrapper${preset === 'bright' ? ' is-original-image' : ''}`}
            style={{
                ...adaptiveStyle,
                ...(overlayHeight !== undefined ? { '--hero-overlay-height': `${overlayHeight}px` } : {}),
            }}
            data-copy-layout="overlay"
            data-hero-artwork-layout={artworkLayout}
        >
            <div
                className="hero-rich-media"
                ref={mediaRef}
                onLoadCapture={event => {
                    if (event.target instanceof HTMLImageElement) sampleRenderedImage(event.target);
                }}
            >
                <button
                    type="button"
                    className="hero-rich-image-link"
                    onClick={onImageOpen}
                    aria-label={imageLabel}
                >
                    {image}
                </button>
                {mediaOverlay}
            </div>
            {copyVariants.map((value, index) => {
                const viewport = responsiveCopy ? (index ? 'phone' : 'desktop') : undefined;
                const title = value.title.trim();
                const subtitle = value.subtitle.trim();
                const body = value.body.trim();
                const ctaLabel = value.ctaLabel.trim();
                const items = value.items.filter(item => item.enabled !== false);
                return (
                    <div
                        key={viewport ?? 'shared'}
                        className={`hero-rich-content ${warm ? 'is-vip' : ''}`}
                        data-hero-copy-viewport={viewport}
                        style={viewport === 'phone' ? heroThemeStyle(value, imageTone) : undefined}
                    >
                        <div
                            className="hero-rich-copy-region"
                            role={copyScrollable ? 'region' : undefined}
                            aria-label={copyScrollable ? title || imageLabel : undefined}
                            tabIndex={copyScrollable ? 0 : undefined}
                        >
                            <div className="hero-rich-copy-surface">
                                {subtitle && (
                                    <div className={`hero-rich-pill ${warm ? 'is-vip-pill' : ''}`}>
                                        {warm ? (
                                            <ShieldCheck aria-hidden="true" />
                                        ) : (
                                            <Zap aria-hidden="true" />
                                        )}
                                        <ContentText as="span">{subtitle}</ContentText>
                                    </div>
                                )}
                                <h1 className="hero-rich-title">{title}</h1>
                                {body && <ContentText className="hero-rich-desc">{body}</ContentText>}
                            </div>
                            {items.length > 0 && (
                                <div className="hero-rich-stats-row">
                                    {items.map((item, itemIndex) => (
                                        <div
                                            className={`hero-stat-badge${warm ? ' is-vip' : ''}`}
                                            key={`${item.label}-${itemIndex}`}
                                        >
                                            <span className="stat-num">{item.label}</span>
                                            <ContentText as="span" className="stat-lbl">
                                                {item.description}
                                            </ContentText>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {ctaLabel && value.targetType !== 'NONE' && (
                            <button
                                type="button"
                                className={`hero-rich-cta-btn ${warm ? 'is-vip-btn' : ''}`}
                                onClick={onOpen}
                            >
                                <span className="hero-rich-cta-label">{ctaLabel}</span>
                                <ChevronRight aria-hidden="true" />
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
