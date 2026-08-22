import type { Plugin } from 'vite';

type StorybookTransform = (
    this: unknown,
    code: string,
    id: string,
    ...args: unknown[]
) => unknown | Promise<unknown>;

export function normalizeStorySourceId(id: string) {
    return id.replace(/[?#].*$/, '');
}

export function patchStorybookGeneratedCode(code: string) {
    const source = 'convertToFilePath(import.meta.url).includes(';
    const replacement = 'decodeURIComponent(convertToFilePath(import.meta.url)).includes(';
    return code.includes(replacement) ? code : code.replace(source, replacement);
}

/**
 * Vitest Browser appends a cache-busting query to module ids while Storybook's
 * test transform only decodes spaces in import.meta.url. Normalize both sides
 * until the upstream transform handles non-ASCII workspace paths itself.
 */
export function patchStorybookTestTransform(plugins: Plugin[]) {
    const plugin = plugins.find(candidate => candidate.name === 'vite-plugin-storybook-test');
    if (!plugin || typeof plugin.transform !== 'function') {
        return false;
    }

    const transform = plugin.transform as StorybookTransform;
    const patchedTransform: StorybookTransform = async function (code, id, ...args) {
        const result = await transform.call(this, code, normalizeStorySourceId(id), ...args);
        if (result && typeof result === 'object' && 'code' in result && typeof result.code === 'string') {
            return {
                ...result,
                code: patchStorybookGeneratedCode(result.code),
            };
        }
        return result;
    };

    plugin.transform = patchedTransform as Plugin['transform'];
    return true;
}
