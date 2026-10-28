// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { getPublicRouteScriptPreloads } from './entry-public-server';
import { type PublicPageData } from './storefront-page-data';

vi.mock('./public-snapshot', () => ({ createPublicSnapshotApp: vi.fn() }));

const page = (kind: string) => ({ request: { kind } }) as PublicPageData;
const wrapper = 'catalog-route-pages-Abc_12-3.js';
const home = 'home-page-Abc_12-3.js';
const emptySource = () => Promise.resolve('');

describe('matching public route script hints', () => {
    it('selects only the two actual home roots without guessing the entry or unrelated features', async () => {
        const assets = [
            'index-Abc_12-3.js',
            'product-detail-page-Abc_12-3.js',
            home,
            'home-page-Abc_12-3.css',
            wrapper,
        ];
        expect(await getPublicRouteScriptPreloads(page('home'), assets, emptySource)).toEqual([
            wrapper,
            home,
        ]);
        expect(assets).toHaveLength(5);
    });

    it.each(['catalog', 'product', 'article', 'login', undefined])('does not hint %s pages', async kind => {
        const input = kind ? page(kind) : ({} as PublicPageData);
        const readSource = vi.fn(emptySource);
        expect(await getPublicRouteScriptPreloads(input, [wrapper, home], readSource)).toEqual([]);
        expect(readSource).not.toHaveBeenCalled();
    });

    it.each(
        [
            [],
            [home],
            [wrapper],
            [wrapper, home, 'home-page-12345678.js'],
            [wrapper, home, 'catalog-route-pages-12345678.js'],
            [wrapper, 'home-page-short.js'],
            [wrapper, 'home-page-123456789.js'],
            [wrapper, 'home-page-Abc_12-3.js?version=1'],
            [wrapper, '../home-page-Abc_12-3.js'],
            [wrapper, 'home-page-../../bad.js'],
            [wrapper, 'home-page-1234"678.js'],
            [wrapper, 'https://example.test/home-page-Abc_12-3.js'],
        ].map(assets => ({ assets })),
    )('omits incomplete, ambiguous or invalid asset sets: $assets', async ({ assets }) => {
        const readSource = vi.fn(emptySource);
        expect(await getPublicRouteScriptPreloads(page('home'), assets, readSource)).toEqual([]);
        expect(readSource).not.toHaveBeenCalled();
    });

    it('walks static import/export dependencies once, including cycles through the already-linked entry', async () => {
        const sources = new Map([
            [wrapper, `import { value } from './shared-12345678.js'; import './side-effect-12345678.js';`],
            [
                home,
                `export { value } from './shared-12345678.js';
                export * from './side-effect-12345678.js';
                const later = () => import('./optional-12345678.js');
                const text = "import './string-12345678.js'";
                const template = \`export * from './template-12345678.js'\`;
                // import './comment-12345678.js';
                /* export * from './block-comment-12345678.js'; */
                const url = import.meta.url;`,
            ],
            ['shared-12345678.js', `import './index-12345678.js';`],
            ['side-effect-12345678.js', 'export const effect = true;'],
            ['index-12345678.js', `import './shared-12345678.js'; import './vendor-12345678.js';`],
            ['vendor-12345678.js', 'export const value = 1;'],
        ]);
        const readSource = vi.fn((file: string) => Promise.resolve(sources.get(file) ?? ''));
        expect(await getPublicRouteScriptPreloads(page('home'), [...sources.keys()], readSource)).toEqual([
            wrapper,
            'shared-12345678.js',
            'index-12345678.js',
            'vendor-12345678.js',
            'side-effect-12345678.js',
            home,
        ]);
        expect(readSource).toHaveBeenCalledTimes(6);
    });

    it.each([
        './missing-12345678.js',
        '../outside-12345678.js',
        './nested/asset-12345678.js',
        './vendor-12345678.js?version=1',
        './vendor-12345678.js#fragment',
        './vendor%2ejs',
        './theme-12345678.css',
        'https://example.test/vendor-12345678.js',
        'react',
    ])('drops the entire hint group for an unsupported dependency %s', async dependency => {
        const readSource = vi.fn(() => Promise.resolve(`import '${dependency}';`));
        const result = await getPublicRouteScriptPreloads(page('home'), [wrapper, home], readSource);
        expect(result).toEqual([]);
        expect(readSource).toHaveBeenCalledExactlyOnceWith(wrapper);
    });

    it('drops the entire hint group after a source read rejects', async () => {
        const readSource = vi.fn((file: string) =>
            file === wrapper ? Promise.resolve('') : Promise.reject(new Error('Missing emitted source')),
        );
        expect(await getPublicRouteScriptPreloads(page('home'), [wrapper, home], readSource)).toEqual([]);
    });

    it.each([96, 97])('bounds a %i-module closure before reading any module twice', async count => {
        const dependencies = Array.from({ length: count - 2 }, (_item, index) => `chunk-${index}.js`);
        const assets = [wrapper, home, ...dependencies];
        const readSource = vi.fn((file: string) =>
            Promise.resolve(file === wrapper ? dependencies.map(name => `import './${name}';`).join('') : ''),
        );
        const result = await getPublicRouteScriptPreloads(page('home'), assets, readSource);
        expect(result).toHaveLength(count === 96 ? count : 0);
        expect(readSource).toHaveBeenCalledTimes(96);
    });

    it.each([false, true])('bounds total UTF-8 source bytes once per module (exceeds=%s)', async exceeds => {
        const source = exceeds ? '//'.concat('你'.repeat(1_400_000)) : ' '.repeat(4 * 1024 * 1024);
        const readSource = vi.fn((file: string) => Promise.resolve(file === wrapper ? source : ''));
        const result = await getPublicRouteScriptPreloads(page('home'), [wrapper, home], readSource);
        expect(result).toEqual(exceeds ? [] : [wrapper, home]);
        expect(readSource).toHaveBeenCalledTimes(exceeds ? 1 : 2);
    });
});
