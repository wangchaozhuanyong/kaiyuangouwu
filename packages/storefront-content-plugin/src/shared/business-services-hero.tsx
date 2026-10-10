import { type CSSProperties, type ReactNode } from 'react';

import './business-services-hero.css';
import { ContentText } from './content-text';
import { heroThemeStyle, type HeroThemeData } from './hero-theme';

export type BusinessServicesHeroLayout = 'stacked' | 'image-overlay';

/** Existing image bindings and layouts stay unchanged until a merchant opts in. */
export function resolveBusinessServicesHeroLayout(
    settings: Record<string, unknown> | null | undefined,
): BusinessServicesHeroLayout {
    return settings?.businessServicesHeroLayout === 'image-overlay' ? 'image-overlay' : 'stacked';
}

/** Storefront and Admin previews share the introduction; each caller owns media and actions. */
export function BusinessServicesHero({
    title,
    body,
    image,
    decoration,
    action,
    layout = 'stacked',
    headingLevel = 'h1',
    className,
    visual,
    imageDimensions,
}: {
    title: string;
    body: string;
    image?: ReactNode;
    decoration?: ReactNode;
    action?: ReactNode;
    layout?: BusinessServicesHeroLayout;
    headingLevel?: 'h1' | 'h3';
    className?: string;
    visual?: HeroThemeData;
    imageDimensions?: { width?: number; height?: number };
}) {
    const Heading = headingLevel;
    const ratio =
        imageDimensions?.width && imageDimensions?.height
            ? imageDimensions.width / imageDimensions.height
            : undefined;
    const overlayStyle =
        image && layout === 'image-overlay'
            ? ({
                  ...heroThemeStyle(visual ?? {}),
                  ...(ratio && Number.isFinite(ratio) && ratio > 0
                      ? { '--services-hero-image-ratio': ratio }
                      : {}),
              } as CSSProperties)
            : undefined;
    return (
        <header
            className={['business-services-heading', className].filter(Boolean).join(' ')}
            data-services-hero-layout={image ? layout : 'stacked'}
            style={overlayStyle}
        >
            {image ? <div className="business-services-hero-media">{image}</div> : decoration}
            <div className="business-services-heading-copy">
                <Heading className="business-services-page-title">{title}</Heading>
                {action}
                <ContentText>{body}</ContentText>
            </div>
        </header>
    );
}
