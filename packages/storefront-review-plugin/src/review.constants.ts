export const storefrontReviewStates = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export type StorefrontReviewState = (typeof storefrontReviewStates)[number];
