/** Shared card projection. These rules intentionally preserve the existing storefront text semantics. */
export interface ProductDescriptionSummary {
    /** Plain text, at most 72 displayed characters followed by the existing ellipsis when truncated. */
    descriptionSummary: string;
    /** Full-body eligibility is checked before truncation, including duplicate-title filtering. */
    descriptionSubtitle: string | null;
    /** Extracted from the complete body, even when warranty text follows the excerpt. */
    warrantyDuration: string | null;
}

export function productDescriptionPlainText(value: string | null | undefined): string {
    return (value ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function trimProductText(value: string | null | undefined, length: number): string {
    const clean = productDescriptionPlainText(value);
    return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

export function sanitizeProductSubtitle(
    description: string | null | undefined,
    productName: string,
    maxLength = 26,
): string | null {
    const clean = productDescriptionPlainText(description);
    if (!clean || clean.length < 3 || /^[\d\s.,\-:;/]+$/u.test(clean)) return null;
    const cleanName = productDescriptionPlainText(productName);
    if (clean === cleanName || clean.toLowerCase().startsWith(cleanName.toLowerCase())) return null;
    return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}

export function productWarrantyDuration(description: string | null | undefined): string | null {
    const plainText = productDescriptionPlainText(description);
    const chineseMatch = plainText.match(
        /(?:质保|保修|保障)\s*[:：]?\s*([0-9一二三四五六七八九十百]+(?:天|日|个月|月|年))/i,
    );
    if (chineseMatch?.[1]) return chineseMatch[1];
    const englishMatch = plainText.match(
        /(?:warranty|guarantee)\s*(?:of|for|:)?\s*(\d+\s*(?:days?|months?|years?))/i,
    );
    return englishMatch?.[1] ?? null;
}

export function productWarrantyLabel(
    duration: string | null | undefined,
    language: 'zh' | 'en',
): string | null {
    return duration ? `${language === 'zh' ? '质保' : 'Warranty '}${duration}` : null;
}

export function projectProductDescription(
    description: string | null | undefined,
    name: string,
): ProductDescriptionSummary {
    return {
        descriptionSummary: trimProductText(description, 72),
        descriptionSubtitle: sanitizeProductSubtitle(description, name, 72),
        warrantyDuration: productWarrantyDuration(description),
    };
}
