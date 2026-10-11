import { FileSpreadsheet, History, Upload, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { AccessibleDialogSurface } from '../../../components/AccessibleDialogSurface';
import { AdminButton } from '../../../components/AdminControls';
import { AdminOverlayPortal } from '../../../components/AdminOverlayHost';
import { FeatureHelpButton } from '../../../components/FeatureHelp';

/** The same shell owns cold module loading and the import workbench. */
export function CatalogImportDialogFrame({
    onClose,
    closeAllowed = true,
    tab = 'IMPORT',
    onTabChange,
    children,
}: {
    onClose: () => void;
    closeAllowed?: boolean;
    tab?: 'IMPORT' | 'HISTORY';
    onTabChange?: (tab: 'IMPORT' | 'HISTORY') => void;
    children: ReactNode;
}) {
    return (
        <AdminOverlayPortal>
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-5"
                onMouseDown={event => {
                    if (event.target === event.currentTarget && closeAllowed) onClose();
                }}
            >
                <AccessibleDialogSurface
                    accessibleName="商品安全导入中心"
                    onRequestClose={() => closeAllowed && onClose()}
                    className="flex h-[96vh] w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl sm:h-[92vh]"
                >
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                        <div>
                            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                                商品安全导入中心
                                <FeatureHelpButton
                                    topic="catalog.products"
                                    title="商品安全导入中心"
                                    description={'先本地解析和预览差异，只有点击“确认执行”后才会写入数据库。'}
                                />
                            </h2>
                        </div>
                        <AdminButton
                            type="button"
                            onClick={onClose}
                            disabled={!closeAllowed}
                            aria-label="关闭商品导入工作区"
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                        >
                            <X className="h-5 w-5" />
                        </AdminButton>
                    </header>
                    <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-5 py-2 sm:px-6">
                        {(['IMPORT', 'HISTORY'] as const).map(value => (
                            <AdminButton
                                type="button"
                                key={value}
                                disabled={!onTabChange}
                                onClick={() => onTabChange?.(value)}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${tab === value ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                            >
                                {value === 'IMPORT' ? (
                                    <Upload className="h-3.5 w-3.5" />
                                ) : (
                                    <History className="h-3.5 w-3.5" />
                                )}
                                {value === 'IMPORT' ? '导入工作区' : '导入历史'}
                            </AdminButton>
                        ))}
                    </div>
                    {children}
                </AccessibleDialogSurface>
            </div>
        </AdminOverlayPortal>
    );
}
