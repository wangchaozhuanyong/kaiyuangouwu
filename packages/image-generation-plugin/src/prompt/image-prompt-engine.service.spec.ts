import { describe, expect, it } from 'vitest';

import {
    firstSuccessfulPromptProvider,
    ImagePromptEngineService,
    optimizerSystemPrompt,
    startOfBeijingDay,
} from './image-prompt-engine.service';

describe('ImagePromptEngineService safety gate', () => {
    const engine = Object.create(ImagePromptEngineService.prototype) as ImagePromptEngineService;

    it('allows ordinary adult portrait requests', () => {
        expect(() => engine.assertSafe('成年女性商业人像，柔和影棚光')).not.toThrow();
    });

    it.each([
        '未成年儿童裸露照片',
        '给明星换脸到广告中',
        '移除这张图的水印',
        '制作 deepfake 冒充对方进行诈骗',
    ])('blocks prohibited request: %s', prompt => {
        expect(() => engine.assertSafe(prompt)).toThrow();
    });
});

describe('prompt optimization daily quota boundary', () => {
    it('resets at midnight in the configured Beijing business timezone', () => {
        expect(startOfBeijingDay(Date.parse('2026-08-27T15:59:59.000Z'))).toEqual(
            new Date('2026-08-26T16:00:00.000Z'),
        );
        expect(startOfBeijingDay(Date.parse('2026-08-27T16:00:00.000Z'))).toEqual(
            new Date('2026-08-27T16:00:00.000Z'),
        );
    });
});

describe('prompt provider failover', () => {
    it('tries GPT/OpenAI first and falls back to Gemini', async () => {
        const attempts: string[] = [];

        const result = await firstSuccessfulPromptProvider(scope => {
            attempts.push(scope);
            if (scope === 'OPENAI') return Promise.reject(new Error('OpenAI unavailable'));
            return Promise.resolve('gemini-result');
        });

        expect(result).toBe('gemini-result');
        expect(attempts).toEqual(['OPENAI', 'GEMINI']);
    });

    it('returns the final provider error when no prompt provider works', async () => {
        await expect(
            firstSuccessfulPromptProvider(scope => Promise.reject(new Error(`${scope} unavailable`))),
        ).rejects.toThrow('GEMINI unavailable');
    });
});

describe('prompt optimizer language instruction', () => {
    it('requires Chinese descriptive fields for Chinese input', () => {
        const prompt = optimizerSystemPrompt('zh');

        expect(prompt).toContain('entirely in Simplified Chinese');
        expect(prompt).toContain('exact user text, brand names, product names, and model names');
    });

    it('requires English descriptive fields for English input', () => {
        expect(optimizerSystemPrompt('en')).toContain('entirely in English');
    });
});
