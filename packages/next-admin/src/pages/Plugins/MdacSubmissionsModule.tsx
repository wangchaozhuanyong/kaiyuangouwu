import { useMutation } from '@apollo/client/react';
import { useState } from 'react';

import { AdminButton } from '../../components/AdminControls';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';

import {
    MDAC_CANCEL,
    MDAC_RETRY,
    MDAC_SUBMISSIONS,
    mdacStatusLabels,
    type MdacAdminSubmission,
    type MdacSubmissionsResult,
} from './mdac-submissions.graphql';

const filters: Array<{ label: string; value?: MdacAdminSubmission['status'] }> = [
    { label: '全部' },
    { label: '排队中', value: 'QUEUED' },
    { label: '已提交', value: 'DONE' },
    { label: '需人工确认', value: 'MANUAL' },
    { label: '未成功', value: 'FAILED' },
];

const secondaryButton =
    'border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50';
const primaryButton = 'bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50';

/** Reviewed operators copy; the stored reason is matched, never rendered raw. */
function failureReason(item: MdacAdminSubmission) {
    const reason = item.lastError ?? '';
    if (/cancelled by an administrator/iu.test(reason)) return '已由管理员终止';
    if (item.status === 'MANUAL') return '官方受理页无法确认，需要人工核对截图';
    if (/captcha|slider/iu.test(reason)) return '官方人机校验未通过';
    if (/validation|please|sila|rejected/iu.test(reason)) return '官网拒绝资料，需要客户核对';
    if (/network|timeout|connect/iu.test(reason)) return '连接官网失败';
    if (/dry run/iu.test(reason)) return '干跑模式：已填表并解滑块，未提交';
    return reason ? '提交未完成，可重新排队' : '—';
}

export function MdacSubmissionsModule() {
    const [filter, setFilter] = useState<MdacAdminSubmission['status']>();
    const [message, setMessage] = useState('');
    const { data, loading, error, refetch } = useAdminQuery<MdacSubmissionsResult>(MDAC_SUBMISSIONS, {
        variables: { status: filter, limit: 100 },
    });
    const [retry, retryState] = useMutation(MDAC_RETRY);
    const [cancel, cancelState] = useMutation(MDAC_CANCEL);
    const busy = retryState.loading || cancelState.loading;
    const items = data?.mdacSubmissions.items ?? [];
    const total = data?.mdacSubmissions.totalItems ?? 0;

    async function act(action: 'retry' | 'cancel', id: string) {
        setMessage('');
        try {
            await (action === 'retry' ? retry({ variables: { id } }) : cancel({ variables: { id } }));
            await refetch();
            setMessage(
                action === 'retry'
                    ? '已重新排队，窗口开启后由服务自动提交。'
                    : '已终止该任务，不会再自动提交。',
            );
        } catch (cause) {
            setMessage(`操作未完成：${toUserFacingError(cause)}`);
        }
    }

    return (
        <section className="space-y-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg font-semibold">入境卡提交</h1>
                    <p className="text-sm text-slate-500">
                        客户在店铺页确认后由服务提交到马来西亚移民局；共 {total} 条任务。
                    </p>
                </div>
                <AdminButton refreshPage className={secondaryButton}>
                    刷新
                </AdminButton>
            </header>

            <div className="flex flex-wrap gap-2">
                {filters.map(item => (
                    <AdminButton
                        key={item.label}
                        className={
                            filter === item.value
                                ? 'border border-blue-600 bg-blue-50 px-3 py-2 text-sm text-blue-700'
                                : secondaryButton
                        }
                        onClick={() => setFilter(item.value)}
                    >
                        {item.label}
                    </AdminButton>
                ))}
            </div>

            {message && (
                <p role="status" className="text-sm text-slate-700">
                    {message}
                </p>
            )}

            {error && !data ? (
                <div className="space-y-2 border border-rose-200 bg-rose-50 p-3 text-sm">
                    <p>任务列表读取失败：{toUserFacingError(error)}</p>
                    <AdminButton className={secondaryButton} onClick={() => void refetch()}>
                        重新读取
                    </AdminButton>
                </div>
            ) : loading && !data ? (
                <p className="text-sm text-slate-500">正在读取任务…</p>
            ) : items.length === 0 ? (
                <p className="text-sm text-slate-500">没有符合条件的提交任务。</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                                <th className="py-2 pr-3 font-medium">旅客</th>
                                <th className="py-2 pr-3 font-medium">护照</th>
                                <th className="py-2 pr-3 font-medium">抵达日</th>
                                <th className="py-2 pr-3 font-medium">状态</th>
                                <th className="py-2 pr-3 font-medium">回执号</th>
                                <th className="py-2 pr-3 font-medium">尝试</th>
                                <th className="py-2 pr-3 font-medium">说明</th>
                                <th className="py-2 font-medium">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => (
                                <tr key={item.id} className="border-b border-slate-100 align-top">
                                    <td className="py-2 pr-3">{item.travelerName}</td>
                                    <td className="py-2 pr-3">{item.passportNo}</td>
                                    <td className="py-2 pr-3">{item.arrivalDate}</td>
                                    <td className="py-2 pr-3">
                                        {mdacStatusLabels[item.status]}
                                        {item.waitingForWindow ? '（等待窗口）' : ''}
                                    </td>
                                    <td className="py-2 pr-3">{item.referenceNo ?? '—'}</td>
                                    <td className="py-2 pr-3">{item.attempts}</td>
                                    <td className="py-2 pr-3 text-slate-500">{failureReason(item)}</td>
                                    <td className="py-2">
                                        {(item.status === 'FAILED' || item.status === 'MANUAL') && (
                                            <AdminButton
                                                className={primaryButton}
                                                disabled={busy}
                                                onClick={() => void act('retry', item.id)}
                                            >
                                                重新提交
                                            </AdminButton>
                                        )}
                                        {(item.status === 'QUEUED' || item.status === 'RUNNING') && (
                                            <AdminButton
                                                className={secondaryButton}
                                                disabled={busy}
                                                onClick={() => void act('cancel', item.id)}
                                            >
                                                终止
                                            </AdminButton>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
