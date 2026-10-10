import { Suspense, useContext, useState, type ComponentType, type ContextType, type ReactNode } from 'react';
import { UNSAFE_LocationContext, UNSAFE_NavigationContext, useOutlet } from 'react-router-dom';

import { isAdminPageDirty } from '../hooks/use-unsaved-changes-warning';
import { TabPageContext } from './tab-page-context';

interface CachedPage {
    path: string;
    locationContext: ContextType<typeof UNSAFE_LocationContext>;
    outlet: ReactNode;
    visited: number;
}

/** Cache visited outlets only; each page keeps its own URL, route params and DOM. */
export function TabbedOutlet({
    openPaths,
    fallback,
    pageFrame: PageFrame,
    cacheLimit = 8,
}: {
    openPaths: string[];
    fallback: ReactNode;
    pageFrame?: ComponentType<{ page: string; active: boolean; children: ReactNode }>;
    cacheLimit?: number;
}) {
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
        const next = {
            path,
            locationContext,
            outlet,
            visited: Math.max(0, ...pages.map(page => page.visited)) + 1,
        };
        const candidates = current
            ? retainedPages.map(page => (page.path === path ? next : page))
            : [...retainedPages, next];
        const clean = candidates
            .filter(page => !isAdminPageDirty(page.path))
            .sort((left, right) => right.visited - left.visited)
            .slice(0, Math.max(1, cacheLimit));
        setPages(
            candidates.filter(
                page => page.path === path || isAdminPageDirty(page.path) || clean.includes(page),
            ),
        );
    }

    return pages.map(page => (
        <div
            key={page.path}
            hidden={page.path !== path}
            inert={page.path !== path}
            className="admin-tab-page relative isolate h-full min-h-0"
        >
            <TabPageContext.Provider value={{ path: page.path, basename, active: page.path === path }}>
                <UNSAFE_LocationContext.Provider value={page.locationContext}>
                    {PageFrame ? (
                        <PageFrame page={page.path} active={page.path === path}>
                            <Suspense fallback={fallback}>{page.outlet}</Suspense>
                        </PageFrame>
                    ) : (
                        <Suspense fallback={fallback}>{page.outlet}</Suspense>
                    )}
                </UNSAFE_LocationContext.Provider>
            </TabPageContext.Provider>
        </div>
    ));
}
