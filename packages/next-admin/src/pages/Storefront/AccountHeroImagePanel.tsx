import { Image as ImageIcon, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';

import accountHeroDefaultImage from '../../../../storefront/src/assets/ui/account-refraction.webp';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { StorefrontAssetRef, StorefrontContentBlock } from '../../graphql/storefront.graphql';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { toUserFacingError } from '../../utils/user-facing-error';
import { AssetPicker } from './storefront-asset-picker';

export function AccountHeroImagePanel({
    block,
    channelName,
    disabled,
    onSave,
}: {
    block: StorefrontContentBlock | null;
    channelName: string;
    disabled: boolean;
    onSave: (asset: StorefrontAssetRef | null) => Promise<void>;
}) {
    const [draft, setDraft] = useState<StorefrontAssetRef | null>(block?.imageAsset ?? null);
    const [clearLegacyUrl, setClearLegacyUrl] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const sourceAssetId = block?.imageAsset?.id ?? null;
    const legacyUrl = block?.imageUrl?.trim() || null;
    const customPreview = draft?.preview ?? (clearLegacyUrl ? null : legacyUrl);
    const dirty = draft?.id !== sourceAssetId || Boolean(clearLegacyUrl && legacyUrl);

    useUnsavedChangesWarning(dirty || saving, '个人中心头图尚未保存，离开后将放弃本次选择。');

    const save = async () => {
        if (disabled || saving || !dirty) return;
        setSaving(true);
        setNotice('');
        setError('');
        try {
            await onSave(draft);
            setNotice(draft ? '已保存到当前店铺。' : '已恢复前台默认头图。');
        } catch (reason) {
            setError(toUserFacingError(reason, '个人中心头图保存失败，请重试'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="self-start rounded-xl border border-slate-200 bg-white" aria-label="个人中心头图">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                <div>
                    <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                        个人中心头图
                        <FeatureHelpButton topic="storefront.decoration" title="个人中心头图" />
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                        用于买家端“个人中心”顶部，不影响头像和店铺 Logo。
                    </p>
                </div>
                <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        customPreview ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'
                    }`}
                >
                    {customPreview ? '自定义图片' : '前台默认图'}
                </span>
            </div>

            <div className="p-5">
                <div className="relative aspect-[2/1] min-h-44 overflow-hidden rounded-xl bg-[#a8a8ee] shadow-inner">
                    <img
                        src={customPreview ?? accountHeroDefaultImage}
                        alt={customPreview ? '当前个人中心头图预览' : '前台默认个人中心头图预览'}
                        className="absolute inset-0 size-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-slate-950/5" />
                    <div className="absolute inset-x-0 top-0 flex items-center gap-3 p-5 text-indigo-950">
                        <span className="grid size-12 place-items-center rounded-full border-2 border-white/90 bg-white/25 text-base font-bold">
                            个人
                        </span>
                        <span>
                            <strong className="block text-base">用户昵称</strong>
                            <small className="mt-1 block text-[11px]">查看个人资料 ›</small>
                        </span>
                    </div>
                    <div className="absolute inset-x-4 bottom-4 grid grid-cols-4 gap-2 text-center text-[10px] font-medium text-indigo-950">
                        {['我的收藏', '优惠券', '网站公告', '邀请返利'].map(label => (
                            <span
                                key={label}
                                className="rounded-md bg-white/15 px-1 py-2 backdrop-blur-[2px]"
                            >
                                <ImageIcon className="mx-auto mb-1 size-4" aria-hidden="true" />
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    建议尺寸 1200 × 630 px，JPG、PNG 或 WebP；主体尽量靠右，左侧保留用户信息安全区。
                </p>

                <div className="mt-4">
                    <AssetPicker
                        label="头图素材"
                        value={draft}
                        fallbackUrl={clearLegacyUrl ? null : legacyUrl}
                        onChange={asset => {
                            setDraft(asset);
                            setClearLegacyUrl(asset == null && Boolean(legacyUrl));
                            setNotice('');
                            setError('');
                        }}
                    />
                </div>

                {notice && (
                    <p role="status" className="mt-3 text-xs text-emerald-700">
                        {notice}
                    </p>
                )}
                {error && (
                    <p role="alert" className="mt-3 text-xs text-rose-700">
                        {error}
                    </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={disabled || saving || !dirty}
                        onClick={() => void save()}
                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                        <Save className="size-4" aria-hidden="true" />
                        {saving ? '正在保存…' : '保存到当前店铺'}
                    </button>
                    <button
                        type="button"
                        disabled={disabled || saving || (!customPreview && !draft)}
                        onClick={() => {
                            setDraft(null);
                            setClearLegacyUrl(Boolean(legacyUrl));
                            setNotice('');
                            setError('');
                        }}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                        <RotateCcw className="size-4" aria-hidden="true" />
                        恢复默认图（保存后生效）
                    </button>
                </div>
                <p className="mt-3 text-[11px] text-slate-400">
                    配置对象：{channelName}。恢复默认不会删除素材库中的图片。
                </p>
            </div>
        </section>
    );
}
