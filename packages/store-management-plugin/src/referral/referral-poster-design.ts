/** Uploaded artwork owns its printed copy; these fields are used only when copying a share message. */
export const artworkPosterCopyPaths: readonly string[] = ['headline', 'rewardText'];

export const legacyPosterColorFields = [
    'background',
    'muted',
    'panel',
    'border',
    'number',
    'button',
    'buttonEnd',
    'buttonInk',
] as const;

/** Preserve the system template palette when making a channel-owned copy. */
export type LegacyPosterDesign = { version: 2 } & Partial<
    Record<(typeof legacyPosterColorFields)[number], string>
>;
