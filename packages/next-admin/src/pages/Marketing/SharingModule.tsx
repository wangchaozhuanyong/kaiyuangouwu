import { useQuery } from '@apollo/client/react';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { ReferralPosterRecord } from '../../graphql/marketing.graphql';
import { SHARING_SETTINGS_QUERY, type SharingSettingsResult } from '../../graphql/sharing.graphql';
import { ErrorState, LoadingState, Message } from '../Settings/settings-ui';
import { PosterEditor } from './ReferralDialogs';
import { PostersPanel } from './ReferralPanels';
import { errorText } from './referral-ui';

export function SharingModule() {
    const query = useQuery<SharingSettingsResult>(SHARING_SETTINGS_QUERY, {
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });

    if (query.loading && !query.data) return <LoadingState />;
    if (query.error && !query.data)
        return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
    const data = query.data;
    if (!data || data.activeChannel.id !== data.referralProgram.channelId) {
        return <ErrorState message="未能读取当前店铺的分享设置" onRetry={() => void query.refetch()} />;
    }
    return (
        <SharingSettings
            key={data.activeChannel.id}
            data={data}
            loading={query.loading}
            readError={query.error?.message}
            refresh={async () => {
                await query.refetch();
            }}
        />
    );
}

function SharingSettings({
    data,
    loading,
    readError,
    refresh,
}: {
    data: SharingSettingsResult;
    loading: boolean;
    readError?: string;
    refresh: () => Promise<void>;
}) {
    const [editing, setEditing] = useState<ReferralPosterRecord | 'NEW' | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [editorError, setEditorError] = useState('');
    const onChanged = async (message: string) => {
        setActionError('');
        setNotice(message);
        try {
            await refresh();
        } catch (error) {
            setActionError(`设置已保存，刷新失败：${errorText(error)}`);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">
                            分享设置 <FeatureHelpButton topic="marketing.poster-templates" title="分享设置" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            {data.activeChannel.code} · 管理客户端分享海报的默认模板、启停、背景与中英文文案
                        </p>
                    </div>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                            setActionError('');
                            void refresh().catch(error => setActionError(errorText(error)));
                        }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>
            <main className="w-full flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {readError && (
                    <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                        分享设置刷新失败，请刷新后继续编辑：{readError}
                    </p>
                )}
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                <PostersPanel
                    disabled={loading || Boolean(readError)}
                    program={data.referralProgram}
                    onChanged={onChanged}
                    onError={setActionError}
                    onEdit={source => {
                        setEditorError('');
                        setEditing(source);
                    }}
                />
            </main>
            {editing && (
                <PosterEditor
                    source={editing}
                    programUpdatedAt={data.referralProgram.updatedAt}
                    rewardRate={data.referralProgram.rewardRate}
                    error={editorError}
                    onError={setEditorError}
                    onClose={() => setEditing(null)}
                    onSaved={async message => {
                        setEditing(null);
                        await onChanged(message);
                    }}
                />
            )}
        </div>
    );
}
