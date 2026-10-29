import { renderToString } from 'react-dom/server';

import { staticModuleImports } from '../scripts/initial-resource-budget.mjs';

import { createPublicSnapshotApp } from './public-snapshot';
import { type PublicPageData } from './storefront-page-data';

/** These home hints depend only on this immutable artifact, never commerce or merchant data. */
export const publicRouteScriptPreloadScope = 'home-static-v1' as const;

/** Optional hints from this renderer's own asset directory; never execute route modules. */
export async function getPublicRouteScriptPreloads(
    page: PublicPageData,
    assetNames: readonly string[],
    readSource: (file: string) => Promise<string>,
): Promise<string[]> {
    if (page.request?.kind !== 'home') return [];
    const roots = ['catalog-route-pages-', 'home-page-'];
    const rootScripts: string[] = [];
    for (const prefix of roots) {
        const matches = assetNames.filter(name => name.startsWith(prefix) && name.endsWith('.js'));
        if (matches.length !== 1 || !new RegExp(`^${prefix}[\\w-]{8}\\.js$`, 'u').test(matches[0])) return [];
        rootScripts.push(matches[0]);
    }
    const assets = new Set(assetNames);
    const scripts = new Set<string>();
    let bytes = 0;
    const visit = async (file: string): Promise<void> => {
        if (scripts.has(file)) return;
        if (!/^[\w-]+\.js$/u.test(file) || !assets.has(file) || scripts.size >= 96)
            throw new Error('Invalid public script closure');
        scripts.add(file);
        const source = await readSource(file);
        bytes += Buffer.byteLength(source, 'utf8');
        if (bytes > 4 * 1024 * 1024) throw new Error('Public script closure exceeds byte limit');
        for (const dependency of staticModuleImports(source)) {
            if (!dependency.startsWith('./')) throw new Error('Invalid public script dependency');
            await visit(dependency.slice(2));
        }
    };
    try {
        for (const file of rootScripts) await visit(file);
        return [...scripts];
    } catch {
        // Hints are optional: missing assets or an unsupported build retain normal browser loading.
        return [];
    }
}

/** A build artifact, loaded by the public HTML controller from the active frontend pointer. */
export async function renderPublicPage(page: PublicPageData): Promise<string> {
    const snapshot = await createPublicSnapshotApp(page);
    try {
        return renderToString(snapshot.element);
    } finally {
        // Route queries can have explicit GC timers. Per-request caches must release
        // them after HTML is produced instead of retaining each render for minutes.
        snapshot.dispose();
    }
}
