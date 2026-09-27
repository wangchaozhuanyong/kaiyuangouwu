/** Internal keys are opt-in diagnostics, never the business label of a control. */
export function TechnicalDetails({
    entries,
}: {
    entries: readonly { label: string; value?: string | null }[];
}) {
    const values = entries.filter(entry => entry.value);
    if (!values.length) return null;
    return (
        <details data-technical-details className="mt-1 text-[10px] font-normal text-slate-400">
            <summary className="w-fit cursor-pointer select-none hover:text-slate-600">查看技术信息</summary>
            <div className="mt-1 space-y-1 rounded-md bg-slate-100 px-2 py-1.5 font-mono">
                {values.map(entry => (
                    <div key={entry.label}>
                        {entry.label}：{entry.value}
                    </div>
                ))}
            </div>
        </details>
    );
}
