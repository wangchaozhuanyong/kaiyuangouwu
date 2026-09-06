import { useEffect, useState } from 'react';
import { renderReferralPoster } from '../../../../storefront/src/referral-poster-layout';
import { PosterAssetChoice, PosterDraft } from './referrals-types';

export function ReferralPosterPreview({
    draft,
    assets,
    rewardRate,
    onValidation,
}: {
    draft: PosterDraft;
    assets: PosterAssetChoice[];
    rewardRate: number;
    onValidation: (value: { pending: boolean; error: string }) => void;
}) {
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [safe, setSafe] = useState(false);
    const [rendered, setRendered] = useState({ key: '', zh: '', en: '', error: '' });
    const selected = assets.find(asset => asset.id === draft.posterBackgroundAssetId);
    const assetSource = selected?.source || selected?.preview;
    const assetPreview = selected?.preview || '';
    const inputKey = JSON.stringify([draft, assetSource, assetPreview, rewardRate, safe]);
    const images = rendered.key === inputKey ? rendered : { zh: '', en: '' };
    const error = rendered.key === inputKey ? rendered.error : '';
    useEffect(() => {
        let cancelled = false;
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
                        storefrontName: isZh ? '当前店铺' : 'Your store',
                        logoUrl: null,
                        rewardRate,
                        shareUrl: 'https://store.example/register?ref=PREVIEW&source=POSTER',
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
    }, [draft, assetSource, assetPreview, rewardRate, safe, onValidation, inputKey]);
    return (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <strong className="text-xs text-slate-700">完整海报预览 · 1080×1920</strong>
                <div className="flex gap-3 text-xs">
                    <label>
                        预览语言{' '}
                        <select
                            aria-label="海报预览语言"
                            value={language}
                            onChange={event => setLanguage(event.target.value as 'zh' | 'en')}
                        >
                            <option value="zh">中文</option>
                            <option value="en">English</option>
                        </select>
                    </label>
                    <label className="flex gap-1">
                        <input
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
                    {error || '正在检查中英文排版…'}
                </p>
            )}
            {selected?.width && selected?.height && selected.width * 16 !== selected.height * 9 ? (
                <p className="mt-3 text-[11px] text-amber-700">
                    所选图片为 {selected.width}×{selected.height}，预览按 9:16 居中裁切；导出仍为 1080×1920。
                </p>
            ) : null}
            <p className="mt-3 text-[11px] text-slate-500">
                这里使用示例店名和示例二维码。正式海报自动使用当前网站品牌、域名、用户邀请码与奖励比例。两种语言都通过排版检查后才能保存。
            </p>
        </section>
    );
}
