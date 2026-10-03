import { Suspense, useContext, useState, type ContextType, type ReactNode } from 'react';
import { UNSAFE_LocationContext, UNSAFE_NavigationContext, useOutlet } from 'react-router-dom';

import { TabPageContext } from './tab-page-context';

interface CachedPage {
    path: string;
    locationContext: ContextType<typeof UNSAFE_LocationContext>;
    outlet: ReactNode;
}

/** Cache visited outlets only; each page keeps its own URL, route params and DOM. */
export function TabbedOutlet({ openPaths, fallback }: { openPaths: string[]; fallback: ReactNode }) {
    const locationContext = useContext(UNSAFE_LocationContext);
    const { basename } = useContext(UNSAFE_NavigationContext);
    const outlet = useOutlet();
    const path = locationContext.location.pathname;
    const [pages, setPages] = useState<CachedPage[]>([]);
    const current = pages.find(page => page.path === path);
    const retainedPages = pages.filter(page => page.path === path || openPaths.includes(page.path));

    // Adjust during render so a previously visited page is never committed with
    // another tab's route params. Closed tabs release their cached component.
    if (
        retainedPages.length !== pages.length ||
        current?.locationContext !== locationContext ||
        current?.outlet !== outlet
    ) {
        const next = { path, locationContext, outlet };
        setPages(
            current
                ? retainedPages.map(page => (page.path === path ? next : page))
                : [...retainedPages, next],
        );
    }

    return pages.map(page => (
        <div key={page.path} hidden={page.path !== path} className="relative isolate h-full min-h-0">
            <TabPageContext.Provider value={{ path: page.path, basename, active: page.path === path }}>
                <UNSAFE_LocationContext.Provider value={page.locationContext}>
                    <Suspense fallback={fallback}>{page.outlet}</Suspense>
                </UNSAFE_LocationContext.Provider>
            </TabPageContext.Provider>
        </div>
    ));
}
