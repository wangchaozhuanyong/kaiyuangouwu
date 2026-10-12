import BrandLoadingContent from './brand-loading-content';

export interface BrandLoadingProps {
    language?: string;
    logoUrl?: string | null;
    storefrontName?: string;
    compact?: boolean;
    local?: boolean;
    label?: string;
    pending?: boolean;
}

export function BrandLoadingIndicator(props: BrandLoadingProps) {
    // The loading presentation is part of bootstrap, so waiting for route code cannot
    // introduce a second bar-only stage before the current store's brand appears.
    return <BrandLoadingContent {...props} />;
}
