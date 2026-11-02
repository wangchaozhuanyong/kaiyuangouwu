import { useState } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';

export function NewsBlogHistoryReplay({
    window,
    disabled,
    collect,
}: {
    window: { start: string; end: string };
    disabled: boolean;
    collect: (range: { historyStart: string; historyEnd: string }) => void;
}) {
    const [start, setStart] = useState(window.start);
    const [end, setEnd] = useState(window.end);
    return (
        <section className="space-y-3">
            <h2 className="text-lg font-semibold">
                历史补采与回放
                <FeatureHelpButton title="历史补采与回放" topic="news-blog.history" />
            </h2>
            <p className="text-sm text-slate-500">
                最多回放 31 天，不含今天。沿用官方来源、去重和免费整理流程；历史 Skill
                使用回放开始前的固定版本，热度明确记录为本次观察，不伪造过去的榜单。无合格资料的日期保留缺口。
            </p>
            <AdminField label="开始日期（马来西亚时间）">
                <AdminInput type="date" value={start} onChange={e => setStart(e.target.value)} />
            </AdminField>
            <AdminField label="结束日期（马来西亚时间）">
                <AdminInput type="date" value={end} onChange={e => setEnd(e.target.value)} />
            </AdminField>
            <AdminButton
                disabled={disabled || !start || !end || start > end}
                onClick={() => collect({ historyStart: start, historyEnd: end })}
            >
                免费补采并回放
            </AdminButton>
        </section>
    );
}
