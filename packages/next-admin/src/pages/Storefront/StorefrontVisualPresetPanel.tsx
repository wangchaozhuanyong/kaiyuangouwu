import { useMutation, useQuery } from '@apollo/client/react';
import { Monitor, Smartphone, X } from 'lucide-react';
import { useState } from 'react';
import {
    storefrontDesktopLayouts,
    storefrontVisualPresets,
    type StorefrontVisualPresetConfig,
} from '../../../../storefront-content-plugin/src/visual-presets';
import { channelRequestContext, getActiveChannelToken } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    STOREFRONT_VISUAL_PRESET_QUERY,
    UPDATE_STOREFRONT_VISUAL_PRESET_MUTATION,
    type StorefrontVisualPresetResult,
} from '../../graphql/storefront-visual-preset.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { storefrontVisualPreviewDocument } from './storefront-visual-preview';

export function StorefrontVisualPresetPanel() {
    const query = useQuery<StorefrontVisualPresetResult>(STOREFRONT_VISUAL_PRESET_QUERY, {
        fetchPolicy: 'no-cache',
        notifyOnNetworkStatusChange: true,
    });
    const [save, mutation] = useMutation<{ updateStorefrontVisualPreset: StorefrontVisualPresetConfig }>(
        UPDATE_STOREFRONT_VISUAL_PRESET_MUTATION,
        { fetchPolicy: 'no-cache' },
    );
    const { hasAnyPermission } = useAdminPermissions();
    const [preview, setPreview] = useState<'mobile' | 'desktop' | null>(null);
    const [draft, setDraft] = useState<StorefrontVisualPresetConfig | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [feedbackChannel, setFeedbackChannel] = useState<string | null>(null);
    const channel = query.data?.activeChannel;
    const storeName = channel ? getChannelDisplayName(channel.code) : '当前店铺';
    const source = query.data?.storefrontVisualPreset;
    const consistent = Boolean(
        source &&
        channel &&
        source.channelId === channel.id &&
        (!getActiveChannelToken() || channel.token === getActiveChannelToken()),
    );
    const selected = consistent && draft?.channelId === source?.channelId ? draft : source;
    const dirty = Boolean(
        consistent &&
        selected &&
        source &&
        (selected.presetId !== source.presetId || selected.desktopLayout !== source.desktopLayout),
    );
    const busy = query.loading || mutation.loading;
    const disabled =
        !consistent || busy || Boolean(query.error) || !hasAnyPermission(['UpdateStorefrontContent']);
    useUnsavedChangesWarning(dirty || mutation.loading, '皮肤或布局选择尚未保存，离开后将放弃本次选择。');
    const reload = async () => {
        const activeToken = getActiveChannelToken();
        setFeedbackChannel(channel?.id ?? null);
        setError('');
        setNotice('');
        try {
            await query.refetch();
            if (getActiveChannelToken() === activeToken) setDraft(null);
        } catch (reason) {
            if (getActiveChannelToken() === activeToken)
                setError(toUserFacingError(reason, '配置读取失败，请重试'));
        }
    };
    const apply = async () => {
        if (disabled || !dirty || !source || !selected || !channel) return;
        const token = channel.token;
        const activeToken = getActiveChannelToken();
        const stillCurrent = () => getActiveChannelToken() === activeToken;
        setFeedbackChannel(channel.id);
        setError('');
        setNotice('');
        try {
            const result = await save({
                context: channelRequestContext(token),
                variables: {
                    input: {
                        channelId: channel.id,
                        expectedRevision: selected.revision,
                        ...(selected.presetId !== source.presetId ? { presetId: selected.presetId } : {}),
                        ...(selected.desktopLayout !== source.desktopLayout
                            ? { desktopLayout: selected.desktopLayout }
                            : {}),
                    },
                },
            });
            if (!stillCurrent()) return;
            const saved = result.data?.updateStorefrontVisualPreset;
            if (
                !saved ||
                saved.channelId !== channel.id ||
                saved.presetId !== selected.presetId ||
                saved.desktopLayout !== selected.desktopLayout
            )
                throw new Error('保存结果不一致，请重新读取配置');
            setDraft(saved);
            setNotice('已保存到当前店铺。');
            try {
                const fresh = await query.refetch();
                if (!stillCurrent()) return;
                if (fresh.data?.storefrontVisualPreset.channelId !== channel.id)
                    throw new Error('店铺已切换');
                setDraft(null);
            } catch (reason) {
                if (stillCurrent())
                    setError(toUserFacingError(reason, '配置已保存，重新读取失败，请刷新确认'));
            }
        } catch (reason) {
            if (stillCurrent()) setError(toUserFacingError(reason, '保存失败，当前选择已保留'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="皮肤与电脑端布局">
            <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                    皮肤与电脑端布局
                    <FeatureHelpButton topic="storefront.decoration" title="皮肤与电脑端布局" />
                </h2>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reload()}
                    className="text-sm text-blue-700 disabled:opacity-40"
                >
                    重新读取
                </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
                各店拥有相同选项，选择仅保存到当前店铺。区块颜色优先于品牌配色，未设置时继承皮肤。
            </p>
            {query.loading && (
                <p role="status" className="mt-3 text-sm">
                    正在读取当前店铺配置…
                </p>
            )}
            {((error && feedbackChannel === channel?.id) || query.error) && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                    {(feedbackChannel === channel?.id && error) ||
                        toUserFacingError(query.error, '配置加载失败')}
                </p>
            )}
            {notice && consistent && feedbackChannel === channel?.id && (
                <p role="status" className="mt-3 text-sm text-emerald-700">
                    {notice}
                </p>
            )}
            {(['presetId', 'desktopLayout'] as const).map(field => (
                <fieldset key={field} disabled={disabled} className="mt-4">
                    <legend className="text-sm font-bold">
                        {field === 'presetId' ? '皮肤' : '电脑端布局'}
                    </legend>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {(field === 'presetId' ? storefrontVisualPresets : storefrontDesktopLayouts).map(
                            option => (
                                <label
                                    key={option.id}
                                    className="flex gap-3 rounded-lg border border-slate-200 p-3"
                                >
                                    <input
                                        type="radio"
                                        name={field}
                                        value={option.id}
                                        checked={consistent && selected?.[field] === option.id}
                                        onChange={() => {
                                            if (selected) setDraft({ ...selected, [field]: option.id });
                                            setNotice('');
                                            setError('');
                                        }}
                                    />
                                    <span>
                                        <strong className="text-sm">{option.name}</strong>
                                        <span className="mt-1 block text-xs text-slate-500">
                                            {option.description}
                                        </span>
                                    </span>
                                </label>
                            ),
                        )}
                    </div>
                </fieldset>
            ))}
            <button
                type="button"
                disabled={disabled || !dirty}
                onClick={() => void apply()}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
                {mutation.loading ? '正在保存…' : '保存到当前店铺'}
            </button>
            <div className="mt-3 flex gap-4 text-sm">
                <button type="button" disabled={!consistent || busy} onClick={() => setPreview('mobile')}>
                    预览效果
                </button>
                <button
                    type="button"
                    disabled={disabled || selected?.presetId === 'classic'}
                    onClick={() => {
                        if (selected) setDraft({ ...selected, presetId: 'classic' });
                        setNotice('');
                        setError('');
                    }}
                >
                    恢复默认皮肤（保存后生效）
                </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
                切换皮肤与布局会保留图片、文案、区块颜色、楼层顺序和开关。
            </p>
            {preview && selected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3">
                    <AccessibleDialogSurface
                        accessibleName="店铺皮肤效果预览"
                        onRequestClose={() => setPreview(null)}
                        className="flex max-h-[94dvh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl bg-white"
                    >
                        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                            <div>
                                <h3 className="flex items-center gap-2 font-bold text-slate-900">
                                    皮肤效果预览{' '}
                                    <FeatureHelpButton
                                        topic="storefront.visual-preset"
                                        title="皮肤效果预览"
                                    />
                                </h3>
                                <p className="text-xs text-slate-500">
                                    组件示例 · 尚未应用的选择不会发布 · 窄屏可横向滑动
                                </p>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    aria-pressed={preview === 'mobile'}
                                    onClick={() => setPreview('mobile')}
                                    className="flex items-center gap-1 text-sm"
                                >
                                    <Smartphone className="h-4 w-4" />
                                    手机
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={preview === 'desktop'}
                                    onClick={() => setPreview('desktop')}
                                    className="flex items-center gap-1 text-sm"
                                >
                                    <Monitor className="h-4 w-4" />
                                    电脑
                                </button>
                                <button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}>
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                        </header>
                        <div className="min-h-0 min-w-0 overflow-auto bg-slate-100 p-3">
                            <iframe
                                title="皮肤组件预览"
                                sandbox=""
                                className="mx-auto block h-[70dvh] max-w-none shrink-0 border-0 bg-white"
                                style={{ width: preview === 'mobile' ? 390 : 1200 }}
                                srcDoc={storefrontVisualPreviewDocument(selected.presetId, storeName)}
                            />
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </section>
    );
}
