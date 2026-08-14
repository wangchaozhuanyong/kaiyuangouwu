export const storefrontCartOwnerTypes = ['SESSION', 'CUSTOMER'] as const;
export type StorefrontCartOwnerType = (typeof storefrontCartOwnerTypes)[number];

export const storefrontCartStates = ['OPEN', 'PAYMENT_PENDING'] as const;
export type StorefrontCartState = (typeof storefrontCartStates)[number];

export const storefrontCartCheckoutStates = ['PREPARED', 'PLACED', 'ABANDONED'] as const;
export type StorefrontCartCheckoutState = (typeof storefrontCartCheckoutStates)[number];
