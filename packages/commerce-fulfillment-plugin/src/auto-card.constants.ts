export const digitalDeliveryModes = ['file_download', 'auto_card'] as const;
export type DigitalDeliveryMode = (typeof digitalDeliveryModes)[number];

export const autoCardPoolItemStates = ['AVAILABLE', 'ASSIGNED', 'DISABLED'] as const;
export type AutoCardPoolItemState = (typeof autoCardPoolItemStates)[number];

export const autoCardDeliveryStates = [
    'WAITING_STOCK',
    'ALLOCATED',
    'RETRYING',
    'SENT',
    'MANUAL_REVIEW',
] as const;
export type AutoCardDeliveryState = (typeof autoCardDeliveryStates)[number];

export const autoCardDeliveryEventTypes = [
    'WAITING_STOCK',
    'ALLOCATED',
    'EMAIL_QUEUED',
    'EMAIL_FAILED',
    'EMAIL_SENT',
    'MANUAL_RETRY',
    'MANUAL_REVIEW',
] as const;
export type AutoCardDeliveryEventType = (typeof autoCardDeliveryEventTypes)[number];

export const AUTO_CARD_MAX_FIELDS = 12;
export const AUTO_CARD_MAX_IMPORT_LINES = 10_000;
export const AUTO_CARD_MAX_LINE_LENGTH = 8_000;
export const AUTO_CARD_MAX_INSTRUCTIONS_LENGTH = 10_000;
export const AUTO_CARD_MAX_DELIMITER_LENGTH = 16;
