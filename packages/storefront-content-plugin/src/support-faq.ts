export interface SupportFaqItem {
    id: string;
    enabled: boolean;
    questionZh: string;
    answerZh: string;
    questionEn: string;
    answerEn: string;
}

export const MAX_SUPPORT_FAQS = 8;

export function supportFaqItems(settings: Record<string, unknown> | null | undefined): SupportFaqItem[] {
    const raw = settings?.supportFaqs;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, MAX_SUPPORT_FAQS).flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const item = entry as Record<string, unknown>;
        const value = (key: keyof SupportFaqItem) => (typeof item[key] === 'string' ? item[key] : '');
        return [
            {
                id: value('id') || `faq-${index}`,
                enabled: item.enabled === true,
                questionZh: value('questionZh'),
                answerZh: value('answerZh'),
                questionEn: value('questionEn'),
                answerEn: value('answerEn'),
            },
        ];
    });
}

export function supportFaqValidation(settings: Record<string, unknown> | null | undefined): string | null {
    const raw = settings?.supportFaqs;
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > MAX_SUPPORT_FAQS)) {
        return `常见问题最多配置 ${MAX_SUPPORT_FAQS} 条`;
    }
    for (const [index, item] of supportFaqItems(settings).entries()) {
        if (!item.enabled) continue;
        if (
            !item.questionZh.trim() ||
            !item.answerZh.trim() ||
            !item.questionEn.trim() ||
            !item.answerEn.trim()
        ) {
            return `请填写第 ${index + 1} 条常见问题的中英文问题与答案`;
        }
        if ([item.questionZh, item.questionEn].some(value => value.trim().length > 160)) {
            return `第 ${index + 1} 条常见问题标题不能超过 160 字`;
        }
        if ([item.answerZh, item.answerEn].some(value => value.trim().length > 1200)) {
            return `第 ${index + 1} 条常见问题答案不能超过 1200 字`;
        }
    }
    return null;
}
