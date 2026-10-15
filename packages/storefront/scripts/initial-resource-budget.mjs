import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Only static module declarations are followed. In particular import() branches
// and strings containing import-like text cannot turn every lazy page into initial JS.
export function staticModuleImports(source) {
    const tokens = [];
    const token =
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/gu;
    for (const match of source.matchAll(token)) {
        const value = match[0];
        if (value.startsWith('//') || value.startsWith('/*') || value.startsWith('`')) continue;
        tokens.push(value);
    }
    const imports = [];
    let depth = 0;
    for (let index = 0; index < tokens.length; index++) {
        const value = tokens[index];
        if (value === '{' || value === '(' || value === '[') depth++;
        if (value === '}' || value === ')' || value === ']') depth--;
        if (depth !== 0 || (value !== 'import' && value !== 'export')) continue;
        if (tokens[index + 1] === '(' || tokens[index + 1] === '.') continue;
        if (value === 'import' && /^["']/u.test(tokens[index + 1] ?? '')) {
            imports.push(tokens[index + 1].slice(1, -1));
            continue;
        }
        for (let cursor = index + 1; cursor < tokens.length && tokens[cursor] !== ';'; cursor++) {
            if (tokens[cursor] === 'from' && /^["']/u.test(tokens[cursor + 1] ?? '')) {
                imports.push(tokens[cursor + 1].slice(1, -1));
                break;
            }
        }
    }
    return imports;
}

export const initialRouteRoots = {
    home: [/^index-[\w-]{8}\.js$/u, /^catalog-route-pages-.*\.js$/u, /^home-page-.*\.js$/u],
    catalog: [/^category-[\w-]{8}\.js$/u, /^category-route-page-.*\.js$/u],
    product: [/^product-[\w-]{8}\.js$/u, /^catalog-route-pages-.*\.js$/u, /^product-detail-page-.*\.js$/u],
    services: [
        /^services-[\w-]{8}\.js$/u,
        /^content-route-pages-.*\.js$/u,
        /^business-services-page-.*\.js$/u,
    ],
    login: [/^login-[\w-]{8}\.js$/u, /^auth-route-pages-.*\.js$/u, /^auth-pages-.*\.js$/u],
};

/** JS/vendor closures plus Vite's exact CSS preload associations; no feature import() speculation. */
export async function initialResourceCosts(distRoot, html) {
    const directory = path.join(distRoot, 'assets');
    const files = await readdir(directory);
    const sources = new Map(
        await Promise.all(
            files
                .filter(file => file.endsWith('.js'))
                .map(async file => [file, await readFile(path.join(directory, file), 'utf8')]),
        ),
    );
    const preloadDependencies = new Map();
    for (const source of sources.values()) {
        const table = source.match(/m\.f=\[([^]*?)\]/u)?.[1];
        if (!table) continue;
        const assets = [...table.matchAll(/["']assets\/([^"']+)["']/gu)].map(match => match[1]);
        for (const match of source.matchAll(
            /import\(["']\.\/([^"']+\.js)["']\)\s*,\s*__vite__mapDeps\(\[([\d,]*)\]\)/gu,
        )) {
            const dependencies = (match[2] ? match[2].split(',') : []).map(index => assets[Number(index)]);
            if (dependencies.some(file => !file)) throw new Error('Invalid Vite initial preload map');
            preloadDependencies.set(match[1], dependencies);
        }
    }
    const base = [
        ...html.matchAll(
            /<(?:script|link)\b[^>]*(?:src|href)=["']\/assets\/([^"']+\.(?:js|css))["'][^>]*>/giu,
        ),
    ].map(match => match[1]);
    const measure = async roots => {
        const assets = new Set();
        const visit = file => {
            if (assets.has(file)) return;
            if (!files.includes(file)) throw new Error(`Missing initial resource: ${file}`);
            assets.add(file);
            const source = sources.get(file);
            if (source)
                for (const dependency of staticModuleImports(source)) {
                    if (!dependency.startsWith('./'))
                        throw new Error(`Unexpected emitted module: ${dependency}`);
                    visit(dependency.slice(2));
                }
            for (const dependency of preloadDependencies.get(file) ?? []) visit(dependency);
        };
        for (const root of roots) visit(root);
        let jsBytes = 0;
        let cssBytes = 0;
        for (const asset of assets) {
            const bytes = (await stat(path.join(directory, asset))).size;
            if (asset.endsWith('.js')) jsBytes += bytes;
            else if (asset.endsWith('.css')) cssBytes += bytes;
        }
        return { jsBytes, cssBytes, assets: [...assets].sort() };
    };
    const result = { startup: await measure(base) };
    for (const [route, patterns] of Object.entries(initialRouteRoots)) {
        const roots = patterns.flatMap(pattern => {
            const matches = files.filter(file => pattern.test(file) && !base.includes(file));
            if (!matches.length) throw new Error(`Missing ${route} initial route module: ${pattern}`);
            return matches;
        });
        result[route] = await measure([...base, ...roots]);
    }
    return result;
}
