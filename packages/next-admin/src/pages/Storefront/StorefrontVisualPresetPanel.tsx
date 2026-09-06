import { useMutation, useQuery } from '@apollo/client/react';
import { Eye, Monitor, Palette, RefreshCw, RotateCcw, Smartphone, X } from 'lucide-react';
import { useState } from 'react';

import {
    storefrontVisualPresets,
    type StorefrontVisualPresetConfig,
    type StorefrontVisualPresetId,
} from '../../../../storefront-content-plugin/src/visual-presets';
import { channelRequestContext } from '../../apollo';
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
        fetchPolicy: 'network-only',
        notifyOnNetworkStatusChange: true,
    });
    const [draft, setDraft] = useState<StorefrontVisualPresetConfig | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [preview, setPreview] = useState<'mobile' | 'desktop' | null>(null);
    const { hasAnyPermission } = useAdminPermissions();
    const canEdit = hasAnyPermission(['UpdateStorefrontContent']);
    const [save, mutation] = useMutation<{ updateStorefrontVisualPreset: StorefrontVisualPresetConfig }>(
        UPDATE_STOREFRONT_VISUAL_PRESET_MUTATION,
    );
    const source = query.data?.storefrontVisualPreset;
    const channel = query.data?.activeChannel;
    const consistent = source && channel && source.channelId === channel.id;
    const selected = consistent && draft?.channelId === source.channelId ? draft : source;
    const dirty = Boolean(consistent && selected && selected.presetId !== source.presetId);
    const busy = mutation.loading || query.loading;
    const disabled = !canEdit || !consistent || busy || Boolean(query.error);
    const storeName = channel ? getChannelDisplayName(channel.code) : '当前店铺';
    useUnsavedChangesWarning(dirty || mutation.loading, '皮肤选择尚未应用，离开后将放弃本次选择。');

    const apply = async (presetId: StorefrontVisualPresetId) => {
        if (disabled || !selected || !source || !channel) return;
        setNotice('');
        setActionError('');
        let saved: StorefrontVisualPresetConfig;
        try {
            const result = await save({
                context: channelRequestContext(channel.token),
                variables: {
                    input: { channelId: channel.id, presetId, expectedRevision: selected.revision },
                },
            });
            const applied = result.data?.updateStorefrontVisualPreset;
            if (!applied || applied.channelId !== channel.id || applied.presetId !== presetId)
                throw new Error('保存结果不一致，请刷新后检查');
            saved = applied;
        } catch (error) {
            setActionError(toUserFacingError(error, '皮肤保存失败，请刷新后重试'));
            return;
        }

        // The mutation confirms persistence; a later read failure must not restore the old selection.
        query.updateQuery((_previous, { complete, previousData }) => {
            if (complete && previousData.activeChannel.id === saved.channelId) {
                return { ...previousData, storefrontVisualPreset: saved };
            }
        });
        setDraft(null);
        setNotice(
            `“${storeName}”已应用${storefrontVisualPresets.find(item => item.id === presetId)?.name}。`,
        );
        try {
            await query.refetch();
        } catch (error) {
            setActionError(
                `皮肤已保存，但重新读取失败。${toUserFacingError(error, '请点击重新载入进行确认')}`,
            );
        }
    };

    return (
        <section
            className="rounded-xl border border-slate-200 bg-white p-5 xl:col-span-2"
            aria-label="店铺皮肤"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                        <Palette className="h-4 w-4" />
                        店铺皮肤
                        <FeatureHelpButton topic="storefront.visual-preset" title="店铺皮肤" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        为“{storeName}”选择商城视觉风格。选择后点击应用，仅影响当前店铺。
                    </p>
                </div>
                <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-slate-600 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => {
                        setDraft(null);
                        setNotice('');
                        setActionError('');
                        void query.refetch().catch(() => undefined);
                    }}
                >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新载入
                </button>
            </div>
            {(actionError || query.error) && (
                <p role="alert" className="mt-3 text-sm text-red-700">
                    {actionError || toUserFacingError(query.error, '皮肤配置加载失败，请重新载入')}
                </p>
            )}
            {notice && (
                <p role="status" className="mt-3 text-sm text-emerald-700">
                    {notice}
                </p>
            )}
            {query.loading && !source ? (
                <p role="status" className="py-6 text-sm text-slate-500">
                    正在加载店铺皮肤…
                </p>
            ) : (
                <>
                    <div
                        className="mt-4 grid gap-3 sm:grid-cols-2"
                        role="radiogroup"
                        aria-label="选择店铺皮肤"
                    >
                        {storefrontVisualPresets.map(preset => (
                            <label
                                key={preset.id}
                                className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${selected?.presetId === preset.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}
                            >
                                <input
                                    type="radio"
                                    name="storefront-visual-preset"
                                    value={preset.id}
                                    checked={selected?.presetId === preset.id}
                                    disabled={disabled}
                                    onChange={() => {
                                        if (source) setDraft({ ...source, presetId: preset.id });
                                        setNotice('');
                                        setActionError('');
                                    }}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2 font-bold text-slate-900">
                                        {preset.name}
                                        {source?.presetId === preset.id && (
                                            <small className="font-normal text-slate-500">当前使用</small>
                                        )}
                                    </span>
                                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                                        {preset.description}
                                    </span>
                                    <span className="mt-3 flex gap-1.5" aria-hidden="true">
                                        {preset.colors.map(color => (
                                            <span
                                                key={color}
                                                className="h-5 w-7 rounded border border-black/10"
                                                style={{ backgroundColor: color }}
                                            />
                                        ))}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            disabled={disabled || !dirty}
                            onClick={() => selected && void apply(selected.presetId)}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                        >
                            {mutation.loading ? '正在应用…' : '应用到当前店铺'}
                        </button>
                        <button
                            type="button"
                            disabled={!consistent || busy}
                            onClick={() => setPreview('mobile')}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
                        >
                            <Eye className="h-4 w-4" />
                            预览效果
                        </button>
                        <button
                            type="button"
                            disabled={disabled || source?.presetId === 'classic'}
                            onClick={() => void apply('classic')}
                            className="flex items-center gap-1.5 text-sm text-slate-600 disabled:opacity-40"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            恢复默认皮肤
                        </button>
                    </div>
                    {!canEdit && (
                        <p className="mt-3 text-xs text-slate-500">
                            当前账号可查看皮肤，需要装修内容编辑权限才能应用。
                        </p>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                        皮肤统一商城的颜色、字体、圆角和阴影；图片与楼层布局继续在装修中管理，独立推广页使用其推广模板。
                    </p>
                </>
            )}
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
