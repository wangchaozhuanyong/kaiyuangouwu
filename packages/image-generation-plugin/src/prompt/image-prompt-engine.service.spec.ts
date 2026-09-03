import { describe, expect, it } from 'vitest';

import {
    firstSuccessfulPromptModel,
    ImagePromptEngineService,
    optimizerSystemPrompt,
    shouldFailoverPromptModel,
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
    it.each([
        ['network error', new Error('socket closed')],
        ['server error', Object.assign(new Error('upstream unavailable'), { details: { httpStatus: 503 } })],
        ['rate limit', Object.assign(new Error('rate limited'), { details: { httpStatus: 429 } })],
    ])('uses a distinct fallback model after a %s', async (_label, firstError) => {
        const attempts: string[] = [];
        const exclusions: string[][] = [];
        const failures: string[] = [];
        const routes = [
            { config: { id: 'model-1' }, code: 'gemini-primary' },
            { config: { id: 'model-2' }, code: 'openai-fallback' },
        ];

        const selected = await firstSuccessfulPromptModel(
            3,
            excludedIds => {
                exclusions.push([...excludedIds]);
                const route = routes[excludedIds.length];
                if (!route) throw new Error('missing test route');
                return Promise.resolve(route);
            },
            route => {
                attempts.push(route.code);
                return route.config.id === 'model-1'
                    ? Promise.reject(firstError)
                    : Promise.resolve('gpt-5.4-mini');
            },
            route => {
                failures.push(route.code);
                return Promise.resolve();
            },
        );

        expect(selected.result).toBe('gpt-5.4-mini');
        expect(selected.route.config.id).toBe('model-2');
        expect(attempts).toEqual(['gemini-primary', 'openai-fallback']);
        expect(exclusions).toEqual([[], ['model-1']]);
        expect(failures).toEqual(['gemini-primary']);
    });

    it('does not send invalid requests to another provider', async () => {
        const attempts: string[] = [];
        const invalidRequest = Object.assign(new Error('invalid prompt payload'), {
            details: { httpStatus: 422 },
        });

        await expect(
            firstSuccessfulPromptModel(
                3,
                excludedIds => Promise.resolve({ config: { id: `model-${excludedIds.length + 1}` } }),
                route => {
                    attempts.push(String(route.config.id));
                    return Promise.reject(invalidRequest);
                },
                () => Promise.resolve(),
            ),
        ).rejects.toThrow('invalid prompt payload');

        expect(attempts).toEqual(['model-1']);
    });

    it('classifies bounded failover statuses', () => {
        expect(shouldFailoverPromptModel(new Error('network error'))).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 502 } })).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 401 } })).toBe(true);
        expect(shouldFailoverPromptModel({ details: { httpStatus: 422 } })).toBe(false);
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
