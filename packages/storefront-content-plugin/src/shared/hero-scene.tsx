import { ChevronRight, ShieldCheck, Zap } from 'lucide-react';
import type { MouseEventHandler, ReactNode } from 'react';

import { normalizedHeroThemePreset } from '../content-visuals';

import { heroThemeStyle, type HeroThemeData } from './hero-theme';

// Storefront and editor use the same frame, regardless of the uploaded artwork dimensions.
export const desktopHeroAspectRatio = 3;
export const desktopHeroMinHeight = 320;
export const mobileHeroMinHeight = 280;

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
    imageLabel,
    onImageOpen,
    onOpen,
}: {
    content: HeroSceneData;
    image: ReactNode;
    imageLabel: string;
    onImageOpen?: MouseEventHandler<HTMLButtonElement>;
    onOpen?: () => void;
}) {
    const warm = normalizedHeroThemePreset(content.settings?.themePreset) === 'warm';
    const items = content.items.filter(item => item.enabled !== false);
    const title = content.title.trim();
    const subtitle = content.subtitle.trim();
    const body = content.body.trim();
    const ctaLabel = content.ctaLabel.trim();
    const adaptiveStyle = heroThemeStyle(content);

    return (
        <div className="hero-scene-wrapper" style={adaptiveStyle}>
            <button
                type="button"
                className="hero-rich-image-link"
                onClick={onImageOpen}
                aria-label={imageLabel}
            >
                {image}
            </button>
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
