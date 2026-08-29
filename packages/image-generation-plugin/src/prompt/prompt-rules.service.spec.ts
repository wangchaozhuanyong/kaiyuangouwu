import { describe, expect, it } from 'vitest';

import { PromptRulesService } from './prompt-rules.service';

describe('PromptRulesService', () => {
    const rules = new PromptRulesService();

    it.each([
        ['白色咖啡机棚拍商品图', 'NONE', 'product-photo'],
        ['电商海报，标题写“夏日大促”', 'NONE', 'ecommerce-poster'],
        ['成年女性商业人像，柔和影棚光', 'NONE', 'portrait'],
        ['现代客厅的高端室内设计效果图', 'NONE', 'interior-design'],
        ['一幅清新的儿童绘本插画', 'NONE', 'illustration'],
        ['保留商品外形，替换背景', 'PRODUCT', 'reference-edit'],
    ] as const)('classifies %s (%s) as %s', (prompt, referenceMode, expectedUseCase) => {
        expect(rules.fallbackSpec(prompt, referenceMode).useCase).toBe(expectedUseCase);
    });

    it('routes exact poster text to Codex Image 2', () => {
        const spec = rules.fallbackSpec('电商海报，标题写“夏日大促”');

        expect(spec.useCase).toBe('ecommerce-poster');
        expect(spec.exactText).toEqual(['夏日大促']);
        expect(rules.recommendation(spec).modelCode).toBe('OPENAI_IMAGE_2');
    });

    it('routes identity-preserving reference work to GPT image', () => {
        const spec = rules.fallbackSpec('保留人物长相，改成影棚光', 'IDENTITY');

        expect(spec.referenceMode).toBe('IDENTITY');
        expect(rules.recommendation(spec).modelCode).toBe('OPENAI_IMAGE_2');
    });

    it('routes transparent product cutouts to Codex Image 1.5', () => {
        const spec = rules.fallbackSpec('把商品抠图并生成透明背景');

        expect(rules.recommendation(spec).modelCode).toBe('OPENAI_IMAGE_1_5');
    });

    it('renders a deterministic prompt and rejects malformed model JSON', () => {
        const spec = rules.fallbackSpec('一款白色咖啡机的棚拍产品图');

        expect(rules.render(spec)).toContain('Subject:');
        expect(rules.validateSpec({ ...spec, colors: 'white' })).toBeUndefined();
        expect(rules.validateSpec({ ...spec, unexpected: true })).toBeUndefined();
        expect(rules.validateSpec({ ...spec, subject: 'x'.repeat(1_201) })).toBeUndefined();
        expect(rules.validateSpec(spec)).toEqual(spec);
    });

    it.each([
        ['商品图，包装文字写“云巧咖啡”', 'NONE', 'OPENAI_IMAGE_2'],
        ['保留人物长相，只改成影棚光', 'IDENTITY', 'OPENAI_IMAGE_2'],
        ['把商品抠图并生成透明背景', 'NONE', 'OPENAI_IMAGE_1_5'],
        ['一款白色咖啡机的棚拍产品图', 'NONE', 'OPENAI_HIGH_QUALITY'],
        ['一幅水彩风格的城市插画', 'NONE', 'GEMINI_FLASH'],
    ] as const)('routes the golden case %s to %s', (prompt, referenceMode, expectedModel) => {
        const spec = rules.fallbackSpec(prompt, referenceMode);
        expect(rules.recommendation(spec).modelCode).toBe(expectedModel);
    });

    it('preserves quoted text and reference invariants in the rendered prompt', () => {
        const spec = rules.fallbackSpec('保留包装和 Logo，文字写“限定礼盒”', 'PRODUCT');
        const rendered = rules.render(spec);

        expect(spec.exactText).toEqual(['限定礼盒']);
        expect(spec.preserve).toContain('用户明确要求保留的参考图主体与细节');
        expect(rendered).toContain('Render this text exactly: "限定礼盒"');
        expect(rendered).toContain('Preserve:');
        expect(rendered).toContain('Avoid:');
    });
});
