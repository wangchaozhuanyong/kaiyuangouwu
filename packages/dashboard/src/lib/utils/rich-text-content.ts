const invisibleContentPattern = /[\s\u00a0\u200b-\u200d\u2060\ufeff]/gu;

/**
 * Returns whether HTML produced by the rich-text editor contains user-visible text.
 * Empty editor markup such as `<p></p>` and non-breaking/zero-width whitespace do not count.
 */
export function hasMeaningfulRichText(value: string | null | undefined): boolean {
    if (!value?.trim()) return false;

    const textContent = new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '';
    return textContent.replace(invisibleContentPattern, '').length > 0;
}
