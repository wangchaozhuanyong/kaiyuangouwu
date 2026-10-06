import React, { useEffect, useRef, useState } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../src/components/AccessibleDialogSurface';
import { AdminButton, AdminInput } from '../../src/components/AdminControls';
import { AdminField } from '../../src/components/AdminField';
import { AdminOverlayPortal } from '../../src/components/AdminOverlayHost';
import { AdminPageWorkspace, PageSkeleton } from '../../src/components/AdminPageWorkspace';
import { AdminVirtualGrid } from '../../src/components/AdminVirtualGrid';
import { FeatureHelpButton } from '../../src/components/FeatureHelp';
import { PageSizeSelect } from '../../src/components/PageSizeSelect';
import { useConfirmDialog } from '../../src/components/confirm-dialog-context';
import { useServerDraft } from '../../src/hooks/use-server-draft';
import { TabbedOutlet } from '../../src/layouts/TabbedOutlet';
import { AdminImage } from '../../src/utils/admin-image';

const paths = [
    ...Array.from({ length: 12 }, (_, index) => `/performance/page/${index + 1}`),
    '/performance/assets',
];
const buttonClass = 'min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold';
const assets = Array.from({ length: 100 }, (_, index) => ({
    id: `asset-${index + 1}`,
    name: `本地素材 ${index + 1}`,
}));
const assetKey = (asset: (typeof assets)[number]) => asset.id;

/** Actual public runtime components with synthetic local state; no backend, account or business writes. */
export function PerformanceFixture() {
    const navigate = useNavigate();
    // This e2e entry uses classic JSX; keep a value reference so import organization retains React.
    const [scope, setScope] = React.useState('A');
    const [seedDirty, setSeedDirty] = useState(false);
    const [tourStep, setTourStep] = useState<number | null>(null);
    const [tourComplete, setTourComplete] = useState(false);
    const [counts, setCounts] = useState({ mounted: 0, dirty: 0, clean: 0 });
    const workspaces = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (tourStep === null) return;
        void navigate(paths[tourStep]);
        const timer = window.setTimeout(() => {
            if (tourStep === 11) {
                setTourStep(null);
                setTourComplete(true);
            } else setTourStep(tourStep + 1);
        }, 160);
        return () => window.clearTimeout(timer);
    }, [tourStep, navigate]);
    useEffect(() => {
        const root = workspaces.current;
        if (!root) return;
        const update = () => {
            const pages = [...root.querySelectorAll('[data-performance-page]')];
            const dirty = pages.filter(page => page.getAttribute('data-fixture-dirty') === 'true').length;
            const next = { mounted: pages.length, dirty, clean: pages.length - dirty };
            setCounts(previous =>
                previous.mounted === next.mounted && previous.dirty === next.dirty ? previous : next,
            );
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-fixture-dirty'],
        });
        return () => observer.disconnect();
    }, []);
    return (
        <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-slate-100 text-slate-900">
            <header className="shrink-0 space-y-2 border-b border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h1 className="text-base font-bold">后台性能交互夹具 · 作用域 {scope}</h1>
                    <output data-testid="cache-count" className="text-xs">
                        挂载 {counts.mounted} · 干净 {counts.clean} · 草稿 {counts.dirty}
                    </output>
                </div>
                <p className="text-xs text-slate-500">
                    仅本地模拟数据；复用实际标签、草稿、弹层和虚拟网格，不代表完整业务验收。
                </p>
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        className={buttonClass}
                        disabled={tourStep !== null}
                        onClick={() => {
                            setSeedDirty(true);
                            setTourComplete(false);
                            setTourStep(0);
                        }}
                    >
                        准备 8 个干净页 + 2 个草稿
                    </AdminButton>
                    <AdminButton
                        className={buttonClass}
                        onClick={() => {
                            setTourStep(null);
                            setSeedDirty(false);
                            setTourComplete(false);
                            setScope(current => (current === 'A' ? 'B' : 'A'));
                            void navigate(paths[0]);
                        }}
                    >
                        确认切换作用域并清空本地草稿
                    </AdminButton>
                    <AdminButton className={buttonClass} onClick={() => void navigate('/performance/assets')}>
                        100 项素材
                    </AdminButton>
                    <span className="self-center text-xs" data-testid="tour-state">
                        {tourStep !== null ? `准备中 ${tourStep + 1}/12` : tourComplete ? '准备完成' : '就绪'}
                    </span>
                </div>
                <nav aria-label="性能夹具标签" className="flex gap-2 overflow-x-auto pb-1">
                    {paths.slice(0, 12).map((path, index) => (
                        <AdminButton
                            key={path}
                            className={`${buttonClass} shrink-0`}
                            onClick={() => void navigate(path)}
                        >
                            第 {index + 1} 页
                        </AdminButton>
                    ))}
                </nav>
            </header>
            <div ref={workspaces} className="min-h-0 flex-1">
                <Routes key={scope}>
                    <Route
                        element={
                            <TabbedOutlet
                                openPaths={paths}
                                fallback={<PageSkeleton />}
                                pageFrame={AdminPageWorkspace}
                            />
                        }
                    >
                        <Route
                            path="/performance/page/:id"
                            element={<DraftPage scope={scope} seedDirty={seedDirty} />}
                        />
                        <Route path="/performance/assets" element={<AssetsGrid />} />
                    </Route>
                </Routes>
            </div>
        </div>
    );
}

function DraftPage({ scope, seedDirty }: { scope: string; seedDirty: boolean }) {
    const { id = '1' } = useParams();
    const navigate = useNavigate();
    const draft = useServerDraft(`${scope}:${id}`, 'v1', { name: `作用域 ${scope} 第 ${id} 页` });
    const [open, setOpen] = useState(false);
    const confirm = useConfirmDialog();
    const setDraft = draft.setDraft;
    useEffect(() => {
        if (seedDirty && Number(id) <= 2) setDraft({ name: `作用域 ${scope} 未保存草稿 ${id}` });
    }, [seedDirty, id, scope, setDraft]);
    const field = (
        <AdminField label="草稿内容">
            <AdminInput
                value={draft.draft?.name ?? ''}
                aria-label={`第 ${id} 页草稿`}
                onChange={event => draft.setDraft({ name: event.target.value })}
                className="w-full rounded-lg border border-slate-300 p-2"
            />
        </AdminField>
    );
    const globalConfirm = () =>
        void confirm({
            title: '全局确认（本地模拟）',
            description: 'Escape 仅关闭此顶层确认；下层页面弹窗及草稿应继续保留。',
            confirmLabel: '确认本地模拟',
        });
    return (
        <article
            data-performance-page={id}
            data-fixture-dirty={draft.dirty}
            className="h-full overflow-y-auto p-4 sm:p-6"
        >
            <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-lg font-bold">
                    第 {id} 页 · {draft.dirty ? '未保存' : '干净'}
                </h2>
                {field}
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        className={buttonClass}
                        onClick={() => draft.setDraft({ name: `手动编辑 ${id}` })}
                    >
                        标记为未保存
                    </AdminButton>
                    <AdminButton className={buttonClass} onClick={() => draft.accept(draft.draft)}>
                        保存本地草稿
                    </AdminButton>
                    <AdminButton className={buttonClass} onClick={() => setOpen(true)}>
                        打开页面弹层
                    </AdminButton>
                    <AdminButton className={buttonClass} onClick={globalConfirm}>
                        打开全局确认
                    </AdminButton>
                </div>
            </div>
            {open && (
                <AdminOverlayPortal>
                    <div
                        data-testid="page-overlay"
                        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3"
                    >
                        <AccessibleDialogSurface
                            accessibleName={`第 ${id} 页弹层`}
                            onRequestClose={() => setOpen(false)}
                            mobilePresentation="compact"
                            className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
                        >
                            <h2 className="text-base font-bold">
                                第 {id} 页弹层 <FeatureHelpButton title="页面弹层" />
                            </h2>
                            {field}
                            <div className="flex flex-wrap gap-2">
                                <AdminButton className={buttonClass} onClick={globalConfirm}>
                                    打开全局确认
                                </AdminButton>
                                <AdminButton
                                    className={buttonClass}
                                    onClick={() =>
                                        void navigate(`/performance/page/${(Number(id) % 12) + 1}`)
                                    }
                                >
                                    暂存弹层并切至下一页
                                </AdminButton>
                                <AdminButton className={buttonClass} onClick={() => setOpen(false)}>
                                    关闭弹层
                                </AdminButton>
                            </div>
                        </AccessibleDialogSurface>
                    </div>
                </AdminOverlayPortal>
            )}
        </article>
    );
}

function AssetsGrid() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [pageSize, setPageSize] = useState(100);
    const [selected, setSelected] = useState<string[]>([]);
    return (
        <section
            data-performance-page="assets"
            data-fixture-dirty="false"
            className="flex h-full min-h-0 flex-col"
        >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white p-3">
                <h2 className="font-bold">100 项素材窗口化 · 已选 {selected.length}</h2>
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={setPageSize} />
                <AdminButton
                    className={buttonClass}
                    onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })}
                >
                    滚到最后一项
                </AdminButton>
            </div>
            <div
                ref={scrollRef}
                data-testid="asset-scroll"
                className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6"
            >
                <AdminVirtualGrid
                    items={assets.slice(0, pageSize)}
                    itemKey={assetKey}
                    scrollRef={scrollRef}
                    renderItem={asset => (
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <AdminImage
                                src="/assets/fixture-auth.svg"
                                alt={asset.name}
                                className="aspect-square w-full bg-slate-50 object-contain"
                            />
                            <label className="flex min-h-14 items-center gap-2 p-2 text-xs">
                                <AdminInput
                                    type="checkbox"
                                    aria-label={`选择${asset.name}`}
                                    checked={selected.includes(asset.id)}
                                    onChange={event =>
                                        setSelected(current =>
                                            event.target.checked
                                                ? [...current, asset.id]
                                                : current.filter(id => id !== asset.id),
                                        )
                                    }
                                />
                                <span className="min-w-0 truncate">{asset.name}</span>
                            </label>
                        </div>
                    )}
                />
            </div>
        </section>
    );
}
