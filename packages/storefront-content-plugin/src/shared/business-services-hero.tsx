import { type ReactNode } from 'react';

import './business-services-hero.css';
import { ContentText } from './content-text';

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
}: {
    title: string;
    body: string;
    image?: ReactNode;
    decoration?: ReactNode;
    action?: ReactNode;
    layout?: BusinessServicesHeroLayout;
    headingLevel?: 'h1' | 'h3';
    className?: string;
}) {
    const Heading = headingLevel;
    return (
        <header
            className={['business-services-heading', className].filter(Boolean).join(' ')}
            data-services-hero-layout={image ? layout : 'stacked'}
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
