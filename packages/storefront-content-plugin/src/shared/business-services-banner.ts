/** One opt-in, fixed artwork contract shared by the storefront and Admin. */
export const SHARED_SERVICES_BANNER_LAYOUT = 'shared-banner';

export const servicesBannerCopyLimits = {
    zh_Hans: { title: 12, body: 14, ctaLabel: 6 },
    en: { title: 26, body: 28, ctaLabel: 16 },
} as const;

export interface ServicesBannerCopy {
    title: string;
    body: string;
    ctaLabel?: string;
}

export function servicesBannerCopyIssues(copy: ServicesBannerCopy, language: 'zh_Hans' | 'en'): string[] {
    const limits = servicesBannerCopyLimits[language];
    const labels = { title: '标题', body: '说明', ctaLabel: '按钮' };
    return (Object.keys(limits) as Array<keyof typeof limits>).flatMap(field => {
        const value = copy[field]?.trim() ?? '';
        if (Array.from(value).length > limits[field]) return [`${labels[field]}最多 ${limits[field]} 个字符`];
        if (field !== 'title' && /[\r\n]/u.test(value)) return [`${labels[field]}只能填写一行`];
        if (field === 'title' && value.split(/\r?\n/u).length > 2) return ['标题最多两行'];
        return [];
    });
}

export function servicesBannerReviewKey(copy: ServicesBannerCopy, imageUrl: string, hasAction: boolean) {
    return JSON.stringify([
        copy.title.trim(),
        copy.body.trim(),
        copy.ctaLabel?.trim() ?? '',
        imageUrl,
        hasAction,
    ]);
}

/** Measures rendered text; character limits alone cannot predict Chinese/English wrapping. */
export function measureServicesBanner(element: HTMLElement): string[] {
    const issues: string[] = [];
    const frame = element.getBoundingClientRect();
    if (!frame.width || !frame.height) return ['等待广告预览显示'];
    if (Math.abs(frame.width / frame.height - 16 / 9) > 0.02) issues.push('广告框架必须保持 16∶9');
    for (const [selector, label, maxLines] of [
        ['.business-services-page-title', '标题', 2],
        ['.business-services-heading-copy p', '说明', 1],
        ['.business-services-heading-link', '按钮', 1],
    ] as const) {
        const node = element.querySelector<HTMLElement>(selector);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects()).filter(value => value.width > 0 && value.height > 0);
        const view = element.ownerDocument.defaultView;
        const leading = Number.parseFloat(view?.getComputedStyle(node).lineHeight ?? '0');
        if (leading && rect.height > leading * maxLines + 2 && selector !== '.business-services-heading-link')
            issues.push(`${label}超出 ${maxLines} 行，请缩短文案`);
        if (
            node.scrollWidth > node.clientWidth + 1 ||
            rects.some(value => value.right > frame.left + frame.width * 0.6 + 1) ||
            rect.right > frame.left + frame.width * 0.6 + 1 ||
            rect.top < frame.top ||
            rect.bottom > frame.bottom ||
            rects.some(value => value.bottom > frame.bottom || value.top < frame.top)
        )
            issues.push(`${label}超出左侧文字区域，请缩短文案`);
    }
    return issues;
}
