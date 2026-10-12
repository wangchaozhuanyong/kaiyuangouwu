import { renderToString } from 'react-dom/server';

import { createPublicSnapshotApp } from './public-snapshot';
import { type PublicPageData } from './storefront-page-data';

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
