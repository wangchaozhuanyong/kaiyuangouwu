/** Sharing assets share the content store, but are never homepage sections. */
export function isSharingContent(block: { settings?: unknown }): boolean {
    const settings = block.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
    const purpose = (settings as Record<string, unknown>).purpose;
    return purpose === 'referral-system-poster' || purpose === 'referral-custom-poster';
}
