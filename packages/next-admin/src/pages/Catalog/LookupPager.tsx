import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageSizeSelect } from '../../components/PageSizeSelect';

export function LookupPager({
    loading = false,
    page,
    pageSize,
    onPageSizeChange,
    totalItems,
    onPageChange,
}: {
    loading?: boolean;
    page: number;
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] text-slate-400">
            <span>
                共 {totalItems} 条 · {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
                <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} disabled={loading} />
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={loading || page === 0}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={loading || page >= totalPages - 1}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
