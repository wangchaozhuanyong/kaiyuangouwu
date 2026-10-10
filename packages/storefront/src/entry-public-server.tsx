import { renderToString } from 'react-dom/server';

import { createPublicSnapshotApp } from './public-snapshot';
import { type PublicPageData } from './storefront-page-data';

/** A build artifact, loaded by the public HTML controller from the active frontend pointer. */
export async function renderPublicPage(page: PublicPageData): Promise<string> {
    return renderToString(await createPublicSnapshotApp(page));
}
