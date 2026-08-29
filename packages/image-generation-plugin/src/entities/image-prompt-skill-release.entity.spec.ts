import { describe, expect, it } from 'vitest';

import { ImagePromptSkillRelease } from './image-prompt-skill-release.entity';

describe('ImagePromptSkillRelease', () => {
    it('derives a safe dashboard summary from the stored rule bundle', () => {
        const release = new ImagePromptSkillRelease({
            bundleVersion: 1,
            sourceHash: 'hash',
            status: 'ACTIVE',
            activatedAt: new Date(),
        });
        release.bundle = {
            useCases: [{ code: 'product-photo' }, { code: 'reference-edit' }, null],
            models: [
                { code: 'OPENAI_IMAGE_2', displayNameZh: 'Codex 图片 2' },
                { code: 'GEMINI_FLASH', displayNameEn: 'Gemini Flash' },
            ],
            routing: { defaultStrategy: 'BALANCED' },
        };

        expect(release.supportedUseCases).toEqual(['product-photo', 'reference-edit']);
        expect(release.supportedModels).toEqual(['Codex 图片 2', 'Gemini Flash']);
        expect(release.routingStrategy).toBe('BALANCED');
    });

    it('returns stable empty summaries for legacy or incomplete bundles', () => {
        const release = new ImagePromptSkillRelease({
            bundleVersion: 1,
            sourceHash: 'legacy-hash',
            status: 'INACTIVE',
            activatedAt: null,
        });
        release.bundle = {};

        expect(release.supportedUseCases).toEqual([]);
        expect(release.supportedModels).toEqual([]);
        expect(release.routingStrategy).toBe('UNKNOWN');
    });
});
