import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import {
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type MouseEventHandler,
    type ReactNode,
} from 'react';

import { normalizedHeroThemePreset } from '../content-visuals';

import { heroThemeStyle, type HeroThemeData } from './hero-theme';

export interface HeroSceneData extends HeroThemeData {
    title: string;
    subtitle: string;
    body: string;
    ctaLabel: string;
    targetType: string;
    imageUrl?: string | null;
    items: Array<{ label: string; description: string; enabled?: boolean }>;
}

/** The carousel and its draft preview render the same saved copy and local contrast surface. */
export function HeroScene({
    content,
    image,
    mediaOverlay,
    imageLabel,
    onImageOpen,
    onOpen,
}: {
    content: HeroSceneData;
    image: ReactNode;
    mediaOverlay?: ReactNode;
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
    const adaptiveStyle = heroThemeStyle(content);
    const mediaRef = useRef<HTMLDivElement>(null);
    const [overlayHeight, setOverlayHeight] = useState(0);

    useLayoutEffect(() => {
        const media = mediaRef.current;
        if (!media) return;
        const overlays = Array.from(media.children).slice(1);
        const measure = () => {
            setOverlayHeight(Math.max(0, ...overlays.map(child => child.getBoundingClientRect().height)));
        };
        const observer = new ResizeObserver(measure);
        overlays.forEach(child => observer.observe(child));
        measure();
        return () => observer.disconnect();
    }, [mediaOverlay]);

    return (
        <div
            className={`hero-scene-wrapper${preset === 'bright' ? ' is-original-image' : ''}`}
            style={{ ...adaptiveStyle, '--hero-overlay-height': `${overlayHeight}px` } as CSSProperties}
            data-copy-layout="overlay"
        >
            <div className="hero-rich-media" ref={mediaRef}>
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
                <div className="hero-rich-copy-surface">
                    {subtitle && (
                        <div className={`hero-rich-pill ${warm ? 'is-vip-pill' : ''}`}>
                            {warm ? <ShieldCheck aria-hidden="true" /> : <Zap aria-hidden="true" />}
                            <span>{subtitle}</span>
                        </div>
                    )}
                    <h1 className="hero-rich-title">{title}</h1>
                    {body && <p className="hero-rich-desc">{body}</p>}
                </div>
                {items.length > 0 && (
                    <div className="hero-rich-stats-row">
                        {items.map((item, index) => (
                            <div
                                className={`hero-stat-badge${warm ? ' is-vip' : ''}`}
                                key={`${item.label}-${index}`}
                            >
                                <span className="stat-num">{item.label}</span>
                                <span className="stat-lbl">{item.description}</span>
                            </div>
                        ))}
                    </div>
                )}
                {ctaLabel && content.targetType !== 'NONE' && (
                    <button
                        type="button"
                        className={`hero-rich-cta-btn ${warm ? 'is-vip-btn' : ''}`}
                        onClick={onOpen}
                    >
                        {ctaLabel}
                        <ChevronRight aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
}
