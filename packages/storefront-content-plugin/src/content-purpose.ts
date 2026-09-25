/** Sharing assets share the content store, but are never homepage sections. */
export function isSharingContent(block: { settings?: unknown }): boolean {
    const settings = block.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
    const purpose = (settings as Record<string, unknown>).purpose;
    return purpose === 'referral-system-poster' || purpose === 'referral-custom-poster';
}

/** Standalone page visuals share the content store but are not homepage floors. */
export function isNonHomepageContent(block: { settings?: unknown }): boolean {
    if (isSharingContent(block)) return true;
    const settings = block.settings;
    return Boolean(
        settings &&
        typeof settings === 'object' &&
        !Array.isArray(settings) &&
        (settings as Record<string, unknown>).purpose === 'desktop-category-banner',
    );
}
