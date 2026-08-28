import { describe, expect, it } from 'vitest';

import { PromptRulesService } from './prompt-rules.service';

describe('PromptRulesService', () => {
    const rules = new PromptRulesService();

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
});
