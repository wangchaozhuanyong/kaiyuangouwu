import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
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
] as const;

export type HeroArtworkLayout = (typeof heroArtworkLayouts)[number]['value'];

export function resolveHeroArtworkLayout(
    settings: Record<string, unknown> | null | undefined,
): HeroArtworkLayout {
    return settings?.heroArtworkLayout === 'editorial' ? 'editorial' : 'overlay';
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
    image,
    mediaOverlay,
    copyScrollable = false,
    imageLabel,
    onImageOpen,
    onOpen,
}: {
    content: HeroSceneData;
    image: ReactNode;
    mediaOverlay?: ReactNode;
    copyScrollable?: boolean;
    imageLabel: string;
    onImageOpen?: MouseEventHandler<HTMLButtonElement>;
    onOpen?: () => void;
}) {
    const preset = normalizedHeroThemePreset(content.settings?.themePreset);
    const warm = preset === 'warm';
    const items = content.items.filter(item => item.enabled !== false);
    const title = content.title.trim();
    const subtitle = content.subtitle.trim();
    const body = content.body.trim();
    const ctaLabel = content.ctaLabel.trim();
    const [sampledTone, setSampledTone] = useState<{ imageUrl: typeof content.imageUrl; tone: ImageTone }>();
    const adaptiveStyle = heroThemeStyle(
        content,
        sampledTone?.imageUrl === content.imageUrl ? sampledTone?.tone : undefined,
    );
    const sampledSource = useRef('');
    const mediaRef = useRef<HTMLDivElement>(null);
    const [overlayHeight, setOverlayHeight] = useState(0);

    const sampleRenderedImage = useCallback(
        (artworkElement: HTMLImageElement) => {
            if (
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
        [content.imageUrl],
    );

    useLayoutEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const artworkElement = media.querySelector<HTMLImageElement>(
            '.hero-rich-image-link img:not([aria-hidden="true"])',
        );
        if (artworkElement) sampleRenderedImage(artworkElement);
        const overlays = Array.from(media.children).slice(1);
        const measure = () => {
            setOverlayHeight(Math.max(0, ...overlays.map(child => child.getBoundingClientRect().height)));
        };
        const observer = new ResizeObserver(measure);
        overlays.forEach(child => observer.observe(child));
        measure();
        return () => observer.disconnect();
    }, [mediaOverlay, sampleRenderedImage]);

    return (
        <div
            className={`hero-scene-wrapper${preset === 'bright' ? ' is-original-image' : ''}`}
            style={{ ...adaptiveStyle, '--hero-overlay-height': `${overlayHeight}px` } as CSSProperties}
            data-copy-layout="overlay"
            data-hero-artwork-layout={resolveHeroArtworkLayout(content.settings)}
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
            <div className={`hero-rich-content ${warm ? 'is-vip' : ''}`}>
                <div
                    className="hero-rich-copy-region"
                    role={copyScrollable ? 'region' : undefined}
                    aria-label={copyScrollable ? title || imageLabel : undefined}
                    tabIndex={copyScrollable ? 0 : undefined}
                >
                    <div className="hero-rich-copy-surface">
                        {subtitle && (
                            <div className={`hero-rich-pill ${warm ? 'is-vip-pill' : ''}`}>
                                {warm ? <ShieldCheck aria-hidden="true" /> : <Zap aria-hidden="true" />}
                                <ContentText as="span">{subtitle}</ContentText>
                            </div>
                        )}
                        <h1 className="hero-rich-title">{title}</h1>
                        {body && <ContentText className="hero-rich-desc">{body}</ContentText>}
                    </div>
                    {items.length > 0 && (
                        <div className="hero-rich-stats-row">
                            {items.map((item, index) => (
                                <div
                                    className={`hero-stat-badge${warm ? ' is-vip' : ''}`}
                                    key={`${item.label}-${index}`}
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
                {ctaLabel && content.targetType !== 'NONE' && (
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
        </div>
    );
}
