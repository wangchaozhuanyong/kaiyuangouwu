import { describe, expect, it } from 'vitest';

import { parseCollectionDescription } from './collection-faq';

describe('collection description FAQ', () => {
    it('splits the intro from a trailing FAQ section', () => {
        expect(
            parseCollectionDescription(
                '正文第一段。\n\n## 常见问题\n### 可以买一个月吗？\n可以。\n### 怎么交付？\n人工核对后开通。',
            ),
        ).toEqual({
            intro: '正文第一段。',
            faq: [
                { question: '可以买一个月吗？', answer: '可以。' },
                { question: '怎么交付？', answer: '人工核对后开通。' },
            ],
        });
    });

    it('keeps multi-line answers together', () => {
        const parsed = parseCollectionDescription('## FAQ\n### 风险是什么？\n第一行\n第二行');
        expect(parsed.faq[0].answer).toBe('第一行\n第二行');
    });

    it('returns the whole description when there is no FAQ heading', () => {
        expect(parseCollectionDescription('只有正文。\n\n### 这不是 FAQ 标题')).toEqual({
            intro: '只有正文。\n\n### 这不是 FAQ 标题',
            faq: [],
        });
    });

    it('stops at the next level-two heading', () => {
        const parsed = parseCollectionDescription(
            '## 常见问题\n### 甲？\n答案甲\n## 其他说明\n这段不属于 FAQ',
        );
        expect(parsed.faq).toEqual([{ question: '甲？', answer: '答案甲' }]);
    });

    it('drops a question without an answer instead of emitting empty text', () => {
        expect(parseCollectionDescription('## 常见问题\n### 没有答案？\n### 有答案？\n答案').faq).toEqual([
            { question: '有答案？', answer: '答案' },
        ]);
    });

    it('caps the number of items and the accepted lengths', () => {
        const many = Array.from({ length: 20 }, (_, index) => `### 问题${index}\n答案${index}`).join('\n');
        expect(parseCollectionDescription(`## 常见问题\n${many}`).faq).toHaveLength(12);
        expect(parseCollectionDescription(`## 常见问题\n### ${'长'.repeat(201)}\n答案`).faq).toEqual([]);
        expect(parseCollectionDescription(`## 常见问题\n### 问题\n${'长'.repeat(1201)}`).faq).toEqual([]);
    });

    it('treats an empty description as no content', () => {
        expect(parseCollectionDescription(null)).toEqual({ intro: '', faq: [] });
        expect(parseCollectionDescription('   ')).toEqual({ intro: '', faq: [] });
    });
});
