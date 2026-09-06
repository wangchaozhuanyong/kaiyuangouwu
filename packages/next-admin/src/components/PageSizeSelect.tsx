import { PAGE_SIZE_OPTIONS, normalizePageSize } from '../utils/pagination';

export function PageSizeSelect({
    pageSize,
    onPageSizeChange,
    disabled = false,
}: {
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    disabled?: boolean;
}) {
    return (
        <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-slate-500">
            <span>每页显示</span>
            <select
                aria-label="每页显示条数"
                value={normalizePageSize(pageSize)}
                onChange={event => onPageSizeChange(normalizePageSize(event.target.value))}
                disabled={disabled}
                className="min-h-8 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {PAGE_SIZE_OPTIONS.map(size => (
                    <option key={size} value={size}>
                        {size} 条
                    </option>
                ))}
            </select>
        </label>
    );
}
