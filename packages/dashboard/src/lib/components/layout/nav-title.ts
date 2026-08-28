import type { I18n } from '@lingui/core';

export function translateNavTitle(i18n: I18n, title: string): string {
    return Object.prototype.hasOwnProperty.call(i18n.messages, title) ? i18n.t(title) : title;
}
