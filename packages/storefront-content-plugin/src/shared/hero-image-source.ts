export interface HeroImageSourceContent {
    imageUrl?: string | null;
    settings?: Record<string, unknown> | null;
}

/** Early navigation hints only need the selected source, not its intrinsic dimensions. */
export function heroImageSourceForViewport(
    content: HeroImageSourceContent | undefined,
    desktop: boolean,
): string {
    const mobile = content?.settings?.mobileImageUrl;
    return (!desktop && typeof mobile === 'string' && mobile.trim()) || content?.imageUrl?.trim() || '';
}
