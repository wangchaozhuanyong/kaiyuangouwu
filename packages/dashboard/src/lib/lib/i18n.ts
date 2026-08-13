export type { I18n, MessageDescriptor, Messages } from '@lingui/core';
export { useLingui } from '@lingui/react';

/**
 * Vendure language codes use underscores, while browser Intl APIs require
 * BCP 47 language tags with hyphens.
 */
export function toBcp47Locale(locale: string): string {
    return locale.replace(/_/g, '-');
}
