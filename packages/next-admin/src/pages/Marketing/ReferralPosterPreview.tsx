import { useEffect, useState } from 'react';
import { isArtworkPosterDesign } from '../../../../common/src/referral-poster-design';
import { renderReferralPoster } from '../../../../storefront/src/referral-poster-layout';
import { AdminInput, AdminSelect } from '../../components/AdminControls';
import { artworkAssetRatioError, posterPreviewUrl } from './poster-artwork-helpers';
import { PosterAssetChoice, PosterDraft } from './referrals-types';

export interface PosterPreviewBrand {
    nameZh: string;
    nameEn: string;
    storefrontUrl?: string | null;
    logoUrl?: string | null;
}

export function ReferralPosterPreview({
    draft,
    assets,
    rewardRate,
    brand,
    onValidation,
}: {
    draft: PosterDraft;
    assets: PosterAssetChoice[];
    rewardRate: number;
    brand?: PosterPreviewBrand;
    onValidation: (value: { pending: boolean; error: string }) => void;
}) {
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [safe, setSafe] = useState(false);
    const [rendered, setRendered] = useState({ key: '', zh: '', en: '', error: '' });
    const selected = assets.find(asset => asset.id === draft.posterBackgroundAssetId);
    const assetSource = selected?.source || selected?.preview;
    const assetPreview = selected?.preview || '';
    const artwork = draft.layoutVariant === 'ARTWORK_QR';
    const design = isArtworkPosterDesign(draft.design) ? draft.design : null;
    const dimensions = artwork && design ? design.canvas : { width: 1080, height: 1920 };
    const ratioError =
        artwork && design ? artworkAssetRatioError(design, selected?.width, selected?.height) : '';
    const inputError = ratioError || (artwork && !assetSource ? '上传完整设计图后即可预览效果' : '');
    const shareUrl = posterPreviewUrl(brand?.storefrontUrl);
    const inputKey = JSON.stringify([draft, assetSource, assetPreview, rewardRate, safe, brand, ratioError]);
    const images = !inputError && rendered.key === inputKey ? rendered : { zh: '', en: '' };
    const error = inputError || (rendered.key === inputKey ? rendered.error : '');
    useEffect(() => {
        let cancelled = false;
        if (inputError) {
            onValidation({ pending: false, error: inputError });
            return;
        }
        onValidation({ pending: true, error: '' });
        const timer = setTimeout(() => {
            const template = {
                ...draft,
                id: draft.id || 'preview',
                posterBackgroundAsset:
                    draft.posterBackgroundAssetId && assetSource
                        ? { id: draft.posterBackgroundAssetId, source: assetSource, preview: assetPreview }
                        : null,
                shareBackgroundAsset: null,
            };
            void Promise.all(
                [true, false].map(isZh =>
                    renderReferralPoster({
                        template,
                        isZh,
                        storefrontName: isZh ? brand?.nameZh || '当前店铺' : brand?.nameEn || 'Your store',
                        logoUrl: brand?.logoUrl || null,
                        rewardRate,
                        shareUrl,
                        showSafeArea: safe,
                    }),
                ),
            )
                .then(([zh, en]) => {
                    if (!cancelled) {
                        setRendered({ key: inputKey, zh, en, error: '' });
                        onValidation({ pending: false, error: '' });
                    }
                })
                .catch(reason => {
                    if (cancelled) return;
                    const message = reason instanceof Error ? reason.message : '海报预览生成失败';
                    setRendered({ key: inputKey, zh: '', en: '', error: message });
                    onValidation({ pending: false, error: message });
                });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [
        draft,
        assetSource,
        assetPreview,
        rewardRate,
        safe,
        onValidation,
        inputKey,
        inputError,
        shareUrl,
        brand?.nameZh,
        brand?.nameEn,
        brand?.logoUrl,
    ]);
    return (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <strong className="text-xs text-slate-700">
                    完整效果 · {dimensions.width}×{dimensions.height}
                </strong>
                <div className="flex gap-3 text-xs">
                    <label>
                        预览语言{' '}
                        <AdminSelect
                            aria-label="海报预览语言"
                            value={language}
                            onChange={event => setLanguage(event.target.value as 'zh' | 'en')}
                        >
                            <option value="zh">中文</option>
                            <option value="en">英文</option>
                        </AdminSelect>
                    </label>
                    <label className="flex gap-1">
                        <AdminInput
                            type="checkbox"
                            checked={safe}
                            onChange={event => setSafe(event.target.checked)}
                        />
                        图案安全区
                    </label>
                </div>
            </div>
            {images[language] ? (
                <img
                    src={images[language]}
                    alt="当前文案的完整海报排版"
                    className="mx-auto w-full max-w-[300px] rounded-lg"
                />
            ) : (
                <p className="py-6 text-center text-xs text-slate-500" role="status">
                    {error || '正在生成预览并检查二维码…'}
                </p>
            )}
            {!artwork &&
            selected?.width &&
            selected?.height &&
            selected.width * 16 !== selected.height * 9 ? (
                <p className="mt-3 text-[11px] text-amber-700">
                    所选图片为 {selected.width}×{selected.height}，预览按 9:16 居中裁切；导出仍为 1080×1920。
                </p>
            ) : null}
            <p className="mt-3 text-[11px] text-slate-500">
                当前店铺：{brand?.nameZh || '当前店铺'}。预览使用测试邀请码
                PREVIEW，不用于真实邀请；正式海报使用当前用户的邀请码。
                {artwork
                    ? '图片中的文字不会自动翻译；复制分享文案独立支持中英文。'
                    : '中英文预览均通过排版检查后才能保存。'}
            </p>
        </section>
    );
}
