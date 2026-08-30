import { describe, expect, it } from 'vitest';

import {
    detectPromptLanguage,
    promptLanguageFromLanguageCode,
    PromptRulesService,
} from './prompt-rules.service';

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

        expect(rules.render(spec)).toContain('主体：');
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
        expect(rendered).toContain('需精确呈现的文字："限定礼盒"');
        expect(rendered).toContain('保留：');
        expect(rendered).toContain('避免：');
    });

    it('renders Chinese prompts entirely with Chinese rule labels and fallback copy', () => {
        const rendered = rules.render(rules.fallbackSpec('一罐百事可乐饮料产品，干净的棚拍背景'));

        expect(rendered).toContain('主体：一罐百事可乐饮料产品');
        expect(rendered).toContain('构图：商品层级清晰');
        expect(rendered).toContain('光线：可控且专业的商业摄影光线');
        expect(rendered).toContain('避免：虚构品牌信息');
        expect(rendered).not.toContain('Subject:');
        expect(rendered).not.toContain('Composition:');
    });

    it('keeps English prompts and fallback copy in English', () => {
        const rendered = rules.render(
            rules.fallbackSpec('A white insulated bottle on a clean studio background'),
        );

        expect(rendered).toContain('Subject: A white insulated bottle');
        expect(rendered).toContain('Composition: clear product hierarchy');
        expect(rendered).toContain('Avoid: invented branding');
        expect(rendered).not.toContain('主体：');
    });

    it('keeps Chinese fallback output localized when an older Skill bundle is active', () => {
        const currentBundle = structuredClone(rules.serializableBundle);
        const legacyBundle = structuredClone(currentBundle) as {
            useCases: Array<Record<string, unknown>>;
        };
        for (const useCase of legacyBundle.useCases) {
            delete useCase.defaultsZh;
            delete useCase.avoidZh;
        }

        try {
            rules.activateBundle(legacyBundle);
            const rendered = rules.render(rules.fallbackSpec('白色咖啡机商品图'));
            expect(rendered).toContain('构图：主体清晰、构图协调');
            expect(rendered).toContain('避免：结构畸变');
            expect(rendered).not.toContain('clear product hierarchy');
        } finally {
            rules.activateBundle(currentBundle);
        }
    });
});

describe('prompt output language', () => {
    it.each([
        ['一罐 Pepsi 可乐产品图', 'en', 'zh'],
        ['Create a poster that says “夏日大促”', 'zh', 'en'],
        ['A clean ecommerce product photo', 'zh', 'en'],
        ['纯中文商品摄影', 'en', 'zh'],
        ['12345', 'zh', 'zh'],
    ] as const)('detects %s with %s fallback as %s', (prompt, fallback, expected) => {
        expect(detectPromptLanguage(prompt, fallback)).toBe(expected);
    });

    it('maps Vendure language codes to the supported prompt languages', () => {
        expect(promptLanguageFromLanguageCode('zh_Hans')).toBe('zh');
        expect(promptLanguageFromLanguageCode('zh-CN')).toBe('zh');
        expect(promptLanguageFromLanguageCode('en')).toBe('en');
        expect(promptLanguageFromLanguageCode('ms')).toBe('en');
    });
});
