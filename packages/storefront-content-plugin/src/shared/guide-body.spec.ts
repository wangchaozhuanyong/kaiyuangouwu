import { describe, expect, it } from 'vitest';

import { guideBodyBlocks } from './guide-body';

describe('guide body literal markdown subset', () => {
    it('maps heading depth onto the article outline without competing with the page title', () => {
        expect(guideBodyBlocks('# 一级\n## 二级\n### 三级')).toEqual([
            { kind: 'heading', level: 2, text: '一级' },
            { kind: 'heading', level: 2, text: '二级' },
            { kind: 'heading', level: 3, text: '三级' },
        ]);
    });

    it('keeps authored line breaks inside one paragraph and splits on blank lines', () => {
        expect(guideBodyBlocks('第一行\n第二行\n\n下一段')).toEqual([
            { kind: 'paragraph', text: '第一行\n第二行' },
            { kind: 'paragraph', text: '下一段' },
        ]);
    });

    it('collects consecutive list items and separates ordered from unordered lists', () => {
        expect(guideBodyBlocks('- 甲\n- 乙\n\n1. 一\n2) 二')).toEqual([
            { kind: 'list', ordered: false, items: ['甲', '乙'] },
            { kind: 'list', ordered: true, items: ['一', '二'] },
        ]);
    });

    it('reads a price table and drops the separator row', () => {
        expect(guideBodyBlocks('| 套餐 | 价格 |\n| --- | --- |\n| Go | ¥38 |\n| Plus | ¥145 |')).toEqual([
            {
                kind: 'table',
                header: ['套餐', '价格'],
                rows: [
                    ['Go', '¥38'],
                    ['Plus', '¥145'],
                ],
            },
        ]);
    });

    it('pads a short row so every row keeps the header width', () => {
        expect(guideBodyBlocks('| A | B | C |\n| --- | --- | --- |\n| 1 |')).toEqual([
            { kind: 'table', header: ['A', 'B', 'C'], rows: [['1', '', '']] },
        ]);
    });

    it('renders a rule and never treats authored HTML as markup', () => {
        expect(guideBodyBlocks('---\n<script>alert(1)</script>')).toEqual([
            { kind: 'rule' },
            { kind: 'paragraph', text: '<script>alert(1)</script>' },
        ]);
    });

    it('ignores an empty body', () => {
        expect(guideBodyBlocks('\n\n')).toEqual([]);
    });
});
