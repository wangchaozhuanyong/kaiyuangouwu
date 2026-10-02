import { Search, X } from 'lucide-react';
import {
    lazy,
    Suspense,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { catalogRouteState } from '../../catalog-route-query';
import { SearchPageContext } from '../../storefront-page-contexts';
import { routeHref } from '../../storefront-router';
import { useStorefront } from '../../StorefrontContext';

const SearchPage = lazy(() =>
    import('../../pages/search-page').then(module => ({ default: module.SearchPage })),
);

export default function DesktopSearch() {
    const context = useStorefront();
    const route = context.displayedRoute ?? context.route;
    const isZh = context.language === 'zh';
    const [query, setQuery] = useState(route.name === 'search' ? (route.term ?? '') : '');
    const [submittedQuery, setSubmittedQuery] = useState(query);
    const [submission, setSubmission] = useState(0);
    const [open, setOpen] = useState(route.name === 'search');
    const [mounted, setMounted] = useState(open);
    const [composing, setComposing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const keyDownRef = useRef<((event: ReactKeyboardEvent<HTMLInputElement>) => void) | null>(null);
    const previousRoute = useRef(routeHref(route));
    const returnRoute = useRef<string | undefined>(undefined);
    const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(840, window.innerWidth - 64);
            const headerBottom = wrapperRef.current?.closest('header')?.getBoundingClientRect().bottom ?? 0;
            const top = Math.max(rect.bottom, headerBottom) + 8;
            setPanelStyle({
                width,
                left: Math.max(32, Math.min(rect.left, window.innerWidth - width - 32)),
                top,
                maxHeight: Math.min(window.innerHeight * 0.65, window.innerHeight - top - 16),
            });
        };
        place();
        const observer = new ResizeObserver(place);
        if (inputRef.current) observer.observe(inputRef.current);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, { passive: true });
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place);
        };
    }, [open]);
    const panelId = useId();
    const show = () => {
        setOpen(true);
        setMounted(true);
    };
    const close = () => setOpen(false);
    const href = routeHref(route);

    useEffect(() => {
        if (href === previousRoute.current) return;
        if (route.name === 'search') {
            setQuery(route.term ?? '');
            setSubmittedQuery(route.term ?? '');
            show();
        } else if (href === returnRoute.current) {
            show();
            returnRoute.current = undefined;
        } else {
            if (open && route.name === 'product') returnRoute.current = previousRoute.current;
            close();
        }
        previousRoute.current = href;
    }, [href]);
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement;
            if (
                !wrapperRef.current?.contains(target) &&
                !target.closest('[role="dialog"], [role="alertdialog"]')
            )
                close();
        };
        const onShortcut = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                show();
                inputRef.current?.focus();
            }
            if (
                event.key === 'Escape' &&
                !event.defaultPrevented &&
                !document.querySelector('.search-filter-sheet')
            )
                close();
        };
        document.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onShortcut);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onShortcut);
        };
    }, []);

    return (
        <div className="desktop-search-anchor" ref={wrapperRef}>
            <form
                className="proto-search-form"
                role="search"
                onSubmit={event => {
                    event.preventDefault();
                    if (composing) return;
                    show();
                    setSubmission(value => value + 1);
                }}
            >
                <Search className="proto-search-icon" aria-hidden="true" />
                <input
                    ref={inputRef}
                    className="proto-search-input"
                    type="search"
                    autoComplete="off"
                    aria-label={isZh ? '搜索商品、分类' : 'Search products and categories'}
                    placeholder={isZh ? '搜索商品、分类' : 'Search products'}
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="dialog"
                    aria-controls={open ? panelId : undefined}
                    value={query}
                    onFocus={show}
                    onClick={show}
                    onChange={event => {
                        setQuery(event.target.value);
                        if (!event.target.value) setSubmittedQuery('');
                        show();
                    }}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    onKeyDown={event => keyDownRef.current?.(event)}
                />
                <button className="proto-search-submit" type="submit">
                    {isZh ? '搜索' : 'Search'}
                </button>
            </form>
            {mounted && (
                <div
                    id={panelId}
                    className="desktop-search-popover"
                    style={panelStyle}
                    role="dialog"
                    aria-label={isZh ? '搜索商品' : 'Search products'}
                    hidden={!open}
                >
                    <div className="desktop-search-popover-heading">
                        <span>
                            {submittedQuery
                                ? isZh
                                    ? '搜索结果'
                                    : 'Search results'
                                : isZh
                                  ? '发现商品'
                                  : 'Discover products'}
                        </span>
                        <button
                            type="button"
                            onClick={() => {
                                close();
                                inputRef.current?.focus();
                                close();
                            }}
                            aria-label={isZh ? '收起搜索' : 'Close search'}
                        >
                            <X size={18} />
                        </button>
                    </div>
                    <Suspense fallback={<p role="status">{isZh ? '正在加载搜索' : 'Loading search'}</p>}>
                        <SearchPageContext.Provider
                            value={{
                                api: context.api,
                                products: context.products,
                                collections: context.collections,
                                market: context.market,
                                locale: context.locale,
                                language: context.language,
                                storefrontCode: context.storefrontCode,
                                customerId: context.customer?.id,
                                initialQuery: route.name === 'search' ? (route.term ?? '') : '',
                                initialFilters: catalogRouteState(
                                    route.name === 'search' ? route : { name: 'search' },
                                ),
                            }}
                        >
                            <SearchPage
                                embedded={{
                                    query,
                                    submittedQuery,
                                    submission,
                                    composing,
                                    active: open,
                                    inputRef,
                                    keyDownRef,
                                    setQuery,
                                    setSubmittedQuery,
                                    close,
                                }}
                            />
                        </SearchPageContext.Provider>
                    </Suspense>
                </div>
            )}
        </div>
    );
}
