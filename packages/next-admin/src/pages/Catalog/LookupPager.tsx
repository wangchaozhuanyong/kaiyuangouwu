import { ChevronLeft, ChevronRight } from 'lucide-react';

export function LookupPager({
    page,
    pageSize,
    totalItems,
    onPageChange,
}: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
            <span>
                共 {totalItems} 条 · {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
