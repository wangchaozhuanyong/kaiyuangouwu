// @vitest-environment jsdom

import { act, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useNavigate,
    useParams,
    useSearchParams,
} from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAccessibleDialog } from '../hooks/use-accessible-dialog';
import {
    requestAppNavigation,
    requestAppTabsClose,
    useUnsavedChangesWarning,
} from '../hooks/use-unsaved-changes-warning';
import { TabbedOutlet } from './TabbedOutlet';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.restoreAllMocks();
});

async function renderTabs(basename = '/') {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const mounts: string[] = [];
    const unmounts: string[] = [];
    let navigate!: ReturnType<typeof useNavigate>;
    let setOpenPaths!: (paths: string[]) => void;
    let setScope!: (scope: string) => void;
    let releaseSlow!: () => void;
    const SlowPage = lazy(
        () =>
            new Promise<{ default: typeof Page }>(resolve => {
                releaseSlow = () => resolve({ default: Page });
            }),
    );

    function Page() {
        const location = useLocation();
        const { id } = useParams();
        const [searchParams, setSearchParams] = useSearchParams();
        const [draft, setDraft] = useState('');
        const [dialogOpen, setDialogOpen] = useState(false);
        const { dialogRef } = useAccessibleDialog(() => setDialogOpen(false), dialogOpen);
        useUnsavedChangesWarning(Boolean(draft), '存在未保存内容');
        useEffect(() => {
            mounts.push(location.pathname);
            return () => {
                unmounts.push(location.pathname);
            };
        }, [location.pathname]);
        return (
            <article
                data-path={location.pathname}
                data-id={id}
                data-search={location.search}
                data-hash={location.hash}
            >
                <input aria-label="草稿" value={draft} onChange={event => setDraft(event.target.value)} />
                <button onClick={() => setDraft(`draft-${id ?? 'list'}`)}>编辑</button>
                <button onClick={() => setSearchParams({ page: '3' })}>分页</button>
                <button onClick={() => setDialogOpen(true)}>弹窗</button>
                <div data-scroll style={{ height: 100, overflowY: 'auto' }}>
                    <div style={{ height: 1000 }}>内容</div>
                </div>
                {dialogOpen && (
                    <section ref={dialogRef} tabIndex={-1} role="dialog">
                        弹窗内容
                    </section>
                )}
                <span>{searchParams.get('page')}</span>
            </article>
        );
    }
    function Shell() {
        const routerNavigate = useNavigate();
        const [openPaths, updatePaths] = useState([
            '/catalog/list',
            '/catalog/products/1',
            '/catalog/products/2',
            '/slow',
        ]);
        const [scope, updateScope] = useState('store-a');
        useEffect(() => {
            navigate = routerNavigate;
            setOpenPaths = updatePaths;
            setScope = updateScope;
        }, [routerNavigate]);
        return <TabbedOutlet key={scope} openPaths={openPaths} fallback={<p role="status">加载中</p>} />;
    }
    await act(async () => {
        root.render(
            <MemoryRouter
                basename={basename}
                initialEntries={[`${basename === '/' ? '' : basename}/catalog/list`]}
            >
                <Routes>
                    <Route element={<Shell />}>
                        <Route path="catalog/list" element={<Page />} />
                        <Route path="catalog/products/:id" element={<Page />} />
                        <Route path="slow" element={<SlowPage />} />
                    </Route>
                </Routes>
            </MemoryRouter>,
        );
    });
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    const page = (path: string) => container.querySelector<HTMLElement>(`article[data-path="${path}"]`)!;
    return {
        container,
        mounts,
        unmounts,
        page,
        go: async (to: string | number) => {
            await act(async () => {
                if (typeof to === 'number') navigate(to);
                else navigate(to);
            });
        },
        click: async (path: string, label: string) => {
            await act(async () =>
                Array.from(page(path).querySelectorAll('button'))
                    .find(button => button.textContent === label)!
                    .click(),
            );
        },
        close: async (paths: string[], retained: string[]) => {
            let accepted = false;
            await act(async () => {
                accepted = requestAppTabsClose(paths);
                if (accepted) setOpenPaths(retained);
            });
            return accepted;
        },
        resetScope: async () => {
            await act(async () => setScope('store-b'));
        },
        releaseSlow: async () => {
            await act(async () => releaseSlow());
        },
    };
}

describe('retained admin tabs', () => {
    it('keeps list pagination, DOM scroll and independent product drafts without remounting', async () => {
        const tabs = await renderTabs();
        await tabs.click('/catalog/list', '分页');
        const list = tabs.page('/catalog/list');
        list.querySelector<HTMLElement>('[data-scroll]')!.scrollTop = 240;
        await tabs.go('/catalog/products/1');
        await tabs.click('/catalog/products/1', '编辑');
        await tabs.go('/catalog/products/2');
        await tabs.click('/catalog/products/2', '编辑');
        expect(tabs.page('/catalog/products/1').dataset.id).toBe('1');
        expect(tabs.page('/catalog/products/2').dataset.id).toBe('2');
        await tabs.go('/catalog/list?page=3');
        expect(tabs.page('/catalog/list')).toBe(list);
        expect(list.dataset.search).toBe('?page=3');
        expect(list.querySelector<HTMLElement>('[data-scroll]')!.scrollTop).toBe(240);
        for (const id of ['1', '2', '1']) {
            await tabs.go(`/catalog/products/${id}`);
            expect(tabs.page(`/catalog/products/${id}`).querySelector('input')!.value).toBe(`draft-${id}`);
        }
        expect(tabs.mounts).toEqual(['/catalog/list', '/catalog/products/1', '/catalog/products/2']);
        expect(tabs.unmounts).toEqual([]);
        expect(tabs.container.querySelectorAll(':scope > div:not([hidden])')).toHaveLength(1);
    });

    it('freezes inactive URL context and supports history and query updates within one tab', async () => {
        const tabs = await renderTabs();
        await tabs.go('/catalog/list?page=2#list');
        await tabs.go('/catalog/products/1?tab=variants#sku');
        expect(tabs.page('/catalog/list').dataset.search).toBe('?page=2');
        expect(tabs.page('/catalog/list').dataset.hash).toBe('#list');
        await tabs.go(-1);
        expect(tabs.page('/catalog/products/1').dataset.search).toBe('?tab=variants');
        expect(tabs.page('/catalog/products/1').dataset.id).toBe('1');
        await tabs.go(1);
        expect(tabs.page('/catalog/products/1').parentElement!.hidden).toBe(false);
        expect(tabs.mounts).toHaveLength(2);
    });

    it('releases a closed page and starts a fresh instance if it is reopened', async () => {
        const tabs = await renderTabs();
        await tabs.go('/catalog/products/1');
        await tabs.go('/catalog/list');
        expect(await tabs.close(['/catalog/products/1'], ['/catalog/list'])).toBe(true);
        expect(tabs.page('/catalog/products/1')).toBeNull();
        expect(tabs.unmounts).toEqual(['/catalog/products/1']);
        await tabs.go('/catalog/products/1');
        expect(tabs.page('/catalog/products/1').querySelector('input')!.value).toBe('');
        expect(tabs.mounts.filter(path => path === '/catalog/products/1')).toHaveLength(2);
    });

    it('isolates lazy loading to its page and keeps a cached page immediately available', async () => {
        const tabs = await renderTabs();
        expect(tabs.container.querySelector('[role="status"]')).toBeNull();
        await tabs.go('/slow');
        expect(tabs.container.querySelector('[role="status"]')!.textContent).toBe('加载中');
        await tabs.go('/catalog/list');
        expect(tabs.page('/catalog/list').parentElement!.hidden).toBe(false);
        expect(tabs.mounts).toEqual(['/catalog/list']);
        await tabs.releaseSlow();
        expect(tabs.page('/slow').parentElement!.hidden).toBe(true);
        expect(tabs.page('/slow').dataset.path).toBe('/slow');
    });

    it.each(['/', '/dashboard'])(
        'keeps edits on navigation but guards closing, unload and logout (%s)',
        async basename => {
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
            const tabs = await renderTabs(basename);
            await tabs.go('/catalog/products/1');
            await tabs.click('/catalog/products/1', '编辑');
            expect(requestAppNavigation('/catalog/list')).toBe(true);
            await tabs.go('/catalog/list');
            expect(confirm).not.toHaveBeenCalled();
            expect(await tabs.close(['/catalog/products/1'], ['/catalog/list'])).toBe(false);
            expect(tabs.page('/catalog/products/1')).not.toBeNull();
            expect(requestAppNavigation('/login')).toBe(false);
            const unload = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(unload);
            expect(unload.defaultPrevented).toBe(true);
            confirm.mockReturnValue(true);
            expect(await tabs.close(['/catalog/products/1'], ['/catalog/list'])).toBe(true);
            confirm.mockClear();
            expect(requestAppNavigation('/login')).toBe(true);
            expect(confirm).not.toHaveBeenCalled();
        },
    );

    it('stops hidden dialogs handling Escape and restores them when their page returns', async () => {
        const tabs = await renderTabs();
        await tabs.click('/catalog/list', '弹窗');
        await tabs.go('/catalog/products/1');
        await act(async () =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(tabs.page('/catalog/list').querySelector('[role="dialog"]')).not.toBeNull();
        await tabs.go('/catalog/list');
        await act(async () =>
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(tabs.page('/catalog/list').querySelector('[role="dialog"]')).toBeNull();
    });

    it('discards cached pages on store scope changes', async () => {
        const tabs = await renderTabs();
        await tabs.go('/catalog/products/1');
        await tabs.click('/catalog/products/1', '编辑');
        await tabs.go('/catalog/list');
        await tabs.resetScope();
        expect(tabs.page('/catalog/products/1')).toBeNull();
        expect(tabs.unmounts).toEqual(['/catalog/list', '/catalog/products/1']);
        expect(tabs.mounts.filter(path => path === '/catalog/list')).toHaveLength(2);
    });
});
