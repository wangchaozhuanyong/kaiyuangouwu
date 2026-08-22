import { describe, expect, it } from 'vitest';
import { normalizeStorySourceId, patchStorybookGeneratedCode } from '../../storybook-test-compat.mjs';

describe('Storybook browser test compatibility', () => {
    it('removes query and hash suffixes from transformed story ids', () => {
        expect(normalizeStorySourceId('/工作区/button.stories.tsx?v=123#story')).toBe(
            '/工作区/button.stories.tsx',
        );
    });

    it('decodes non-ASCII import.meta.url paths before matching', () => {
        const source = 'convertToFilePath(import.meta.url).includes(storyPath)';
        expect(patchStorybookGeneratedCode(source)).toBe(
            'decodeURIComponent(convertToFilePath(import.meta.url)).includes(storyPath)',
        );
    });

    it('does not patch generated code twice', () => {
        const source = 'decodeURIComponent(convertToFilePath(import.meta.url)).includes(storyPath)';
        expect(patchStorybookGeneratedCode(source)).toBe(source);
    });
});
