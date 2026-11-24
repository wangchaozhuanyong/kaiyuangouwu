/**
 * A collection description may end with a literal FAQ section. The same parser feeds the
 * rendered page and the FAQPage structured data, so the two can never disagree.
 *
 *   ## 常见问题
 *   ### Codex Go 和 Plus 有什么区别？
 *   主要差别是额度与并发，功能入口一致。
 */
export interface CollectionFaqItem {
    question: string;
    answer: string;
}

export interface CollectionDescription {
    /** Everything before the FAQ heading, rendered as the ordinary intro. */
    intro: string;
    faq: CollectionFaqItem[];
}

const faqHeading = /^##\s*(?:常见问题|faq)\s*$/iu;
const otherHeading = /^##\s+/u;
const question = /^###\s+(.+)$/u;
const MAX_ITEMS = 12;
const MAX_QUESTION = 200;
const MAX_ANSWER = 1200;

export function parseCollectionDescription(description: string | null | undefined): CollectionDescription {
    const text = String(description ?? '')
        .replace(/\r\n?/gu, '\n')
        .trim();
    if (!text) return { intro: '', faq: [] };
    const lines = text.split('\n');
    const start = lines.findIndex(line => faqHeading.test(line.trim()));
    if (start < 0) return { intro: text, faq: [] };

    const intro = lines.slice(0, start).join('\n').trim();
    const faq: CollectionFaqItem[] = [];
    let current: { question: string; answer: string[] } | null = null;
    const flush = () => {
        if (!current) return;
        const item = {
            question: current.question.trim(),
            answer: current.answer.join('\n').trim(),
        };
        if (
            item.question &&
            item.answer &&
            item.question.length <= MAX_QUESTION &&
            item.answer.length <= MAX_ANSWER
        )
            faq.push(item);
        current = null;
    };
    for (const line of lines.slice(start + 1)) {
        if (faq.length >= MAX_ITEMS) break;
        if (otherHeading.test(line)) break;
        const asked = question.exec(line);
        if (asked) {
            flush();
            current = { question: asked[1], answer: [] };
            continue;
        }
        if (!current) continue;
        if (!line.trim() && !current.answer.length) continue;
        current.answer.push(line);
    }
    flush();
    return { intro, faq: faq.slice(0, MAX_ITEMS) };
}
