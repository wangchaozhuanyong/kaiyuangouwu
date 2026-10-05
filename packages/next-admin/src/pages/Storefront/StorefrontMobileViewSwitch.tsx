import { AdminButton } from '../../components/AdminControls';

export type StorefrontMobileView = 'edit' | 'preview';

/** Both panels stay mounted so switching the mobile view cannot discard editor state. */
export function StorefrontMobileViewSwitch({
    value,
    onChange,
}: {
    value: StorefrontMobileView;
    onChange: (value: StorefrontMobileView) => void;
}) {
    return (
        <div role="group" aria-label="编辑与预览视图" className="grid grid-cols-2 gap-2 xl:hidden">
            {(['edit', 'preview'] as const).map(view => (
                <AdminButton
                    key={view}
                    type="button"
                    aria-pressed={value === view}
                    onClick={() => onChange(view)}
                    className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${value === view ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
                >
                    {view === 'edit' ? '编辑内容' : '页面预览'}
                </AdminButton>
            ))}
        </div>
    );
}
