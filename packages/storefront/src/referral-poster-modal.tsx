import { Check, Copy, Download, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { referralShareUrl } from './referral-attribution';
import {
    availablePosterTemplates,
    posterRenderKey,
    renderReferralPoster,
    replacePosterTokens,
} from './referral-poster-layout';
import { acquireBodyScrollLock } from './scroll-lock';
import './styles/modals-and-support.css';
import { ReferralPosterTemplate, StorefrontLanguage } from './types';

const localized = (zh: string, en: string, isZh: boolean) => (isZh ? zh : en);

export function ReferralPosterModal({
    inviteCode,
    storefrontName,
    logoUrl,
    language,
    rewardRate,
    templates,
    templateConfigs = [],
    systemTemplateConfigs = [],
    defaultTemplate,
    channelId,
    onClose,
    onNotify,
}: {
    inviteCode: string;
    storefrontName: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    rewardRate: number;
    templates: string[];
    templateConfigs?: ReferralPosterTemplate[];
    systemTemplateConfigs?: ReferralPosterTemplate[];
    defaultTemplate: string;
    channelId: string;
    onClose: () => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const styles = useMemo(
        () => availablePosterTemplates(templates, systemTemplateConfigs, templateConfigs),
        [templates, systemTemplateConfigs, templateConfigs],
    );
    const [selectedId, setSelectedId] = useState(defaultTemplate);
    const [copied, setCopied] = useState(false);
    const [retry, setRetry] = useState(0);
    const [rendered, setRendered] = useState({ key: '', data: '', error: '' });
    const style =
        styles.find(item => item.id === selectedId) ??
        styles.find(item => item.id === defaultTemplate) ??
        styles[0];
    const shareUrl = referralShareUrl(inviteCode, 'POSTER');
    const renderKey = style
        ? posterRenderKey({
              channelId,
              shareUrl,
              language,
              storefrontName,
              logoUrl,
              rewardRate,
              template: style,
          })
        : '';
    // A result is only visible for its exact store, user, locale and template inputs.
    const posterDataUrl = rendered.key === renderKey ? rendered.data : '';
    const renderError = rendered.key === renderKey ? rendered.error : '';
    const generating = Boolean(style && !posterDataUrl && !renderError);
    const posterCacheRef = useRef(new Map<string, string>());
    const navRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef(new Map<string, HTMLButtonElement>());
    useEffect(() => acquireBodyScrollLock(), []);
    useEffect(() => {
        setSelectedId(defaultTemplate);
        setCopied(false);
    }, [channelId, defaultTemplate]);
    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);
    useEffect(() => {
        if (style && selectedId !== style.id) setSelectedId(style.id);
    }, [selectedId, style]);
    useEffect(() => {
        if (!style) return;
        const cached = posterCacheRef.current.get(renderKey);
        if (cached) {
            setRendered({ key: renderKey, data: cached, error: '' });
            return;
        }
        let cancelled = false;
        setRendered({ key: renderKey, data: '', error: '' });
        void renderReferralPoster({ template: style, isZh, storefrontName, logoUrl, rewardRate, shareUrl })
            .then(data => {
                if (cancelled) return;
                const oldestKey = posterCacheRef.current.keys().next().value;
                if (posterCacheRef.current.size >= 8 && oldestKey !== undefined)
                    posterCacheRef.current.delete(oldestKey);
                posterCacheRef.current.set(renderKey, data);
                setRendered({ key: renderKey, data, error: '' });
            })
            .catch(error => {
                if (!cancelled)
                    setRendered({
                        key: renderKey,
                        data: '',
                        error:
                            error instanceof Error
                                ? error.message
                                : isZh
                                  ? '海报生成失败，请重试'
                                  : 'Could not generate poster',
                    });
            });
        return () => {
            cancelled = true;
        };
    }, [renderKey, retry]);
    useEffect(() => {
        const container = navRef.current;
        const button = itemRefs.current.get(selectedId);
        if (container && button)
            container.scrollTo({
                left: Math.max(0, button.offsetLeft - (container.clientWidth - button.clientWidth) / 2),
                behavior: 'smooth',
            });
    }, [selectedId]);
    if (!style) return null;

    const copyText = async () => {
        const headline = localized(style.headlineZh, style.headlineEn, isZh);
        const rewardCopy =
            rewardRate > 0
                ? replacePosterTokens(
                      localized(style.rewardTextZh, style.rewardTextEn, isZh),
                      rewardRate,
                      storefrontName,
                  )
                : '';
        const message = isZh
            ? `${headline}\n${rewardCopy}\n我的邀请码：${inviteCode}\n${shareUrl}`
            : `${headline}\n${rewardCopy}\nMy invitation code: ${inviteCode}\n${shareUrl}`;
        try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
            onNotify(isZh ? '分享文案已复制' : 'Share message copied');
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            onNotify(isZh ? '复制失败，请手动复制邀请链接' : 'Could not copy the share message');
        }
    };

    const download = () => {
        if (!posterDataUrl) {
            onNotify(isZh ? '海报还在生成，请稍候' : 'The poster is still being generated');
            return;
        }
        const anchor = document.createElement('a');
        anchor.download = `${storefrontName}-${isZh ? '邀请海报' : 'referral-poster'}-${style.id}.png`;
        anchor.href = posterDataUrl;
        anchor.click();
        onNotify(isZh ? '邀请海报已保存' : 'Referral poster saved');
    };

    return (
        <div
            className={
                'fixed inset-0 z-[100] flex items-start justify-center overflow-x-hidden overflow-y-auto ' +
                'bg-slate-950/65 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ' +
                'pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm'
            }
            role="dialog"
            aria-modal="true"
            aria-label={isZh ? '选择邀请海报' : 'Choose referral poster'}
            onClick={onClose}
        >
            <div
                className="relative my-auto w-full max-w-sm min-w-0 overflow-hidden rounded-3xl bg-white px-4 pb-4 pt-14 shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-white/95 text-slate-600 shadow"
                    onClick={onClose}
                    aria-label={isZh ? '关闭' : 'Close'}
                >
                    <X className="size-4" />
                </button>
                <p className="sr-only">
                    {localized(style.headlineZh, style.headlineEn, isZh)}{' '}
                    {replacePosterTokens(
                        localized(style.rewardTextZh, style.rewardTextEn, isZh),
                        rewardRate,
                        storefrontName,
                    )}{' '}
                    {isZh ? '我的邀请码' : 'My invitation code'} {inviteCode}
                </p>
                <div className="referral-poster-preview relative mx-auto shrink-0 overflow-hidden rounded-[20px] bg-slate-100 shadow-inner">
                    {posterDataUrl ? (
                        <img
                            className={`size-full object-contain transition-opacity duration-150 ${generating ? 'opacity-70' : 'opacity-100'}`}
                            src={posterDataUrl}
                            alt={isZh ? `${style.name}邀请海报预览` : `${style.name} referral poster preview`}
                        />
                    ) : (
                        <div className="grid size-full place-items-center bg-[linear-gradient(145deg,#172554,#7c3aed,#db2777)] text-sm font-bold text-white">
                            {renderError
                                ? isZh
                                    ? '海报生成失败'
                                    : 'Poster unavailable'
                                : isZh
                                  ? '正在生成海报…'
                                  : 'Generating poster…'}
                        </div>
                    )}
                    {generating && posterDataUrl && (
                        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-900/15 backdrop-blur-[1px] transition-opacity">
                            <div className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-sm">
                                <div className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                <span>{isZh ? '正在生成…' : 'Generating…'}</span>
                            </div>
                        </div>
                    )}
                </div>
                {renderError && (
                    <div className="mt-3 text-xs text-rose-700" role="alert">
                        <p>{renderError}</p>
                        <button
                            type="button"
                            className="mt-2 underline"
                            onClick={() => setRetry(value => value + 1)}
                        >
                            {isZh ? '重新生成' : 'Try again'}
                        </button>
                    </div>
                )}
                {styles.length > 1 && (
                    <div
                        ref={navRef}
                        className={
                            'poster-templates-scroll mt-4 flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1 ' +
                            '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
                        }
                        role="list"
                        aria-label={isZh ? '海报模板' : 'Poster templates'}
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                        {styles.map(item => (
                            <button
                                key={item.id}
                                ref={el => {
                                    if (el) itemRefs.current.set(item.id, el);
                                    else itemRefs.current.delete(item.id);
                                }}
                                type="button"
                                data-template-id={item.id}
                                data-active={selectedId === item.id}
                                className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                                    selectedId === item.id
                                        ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                                }`}
                                onClick={() => setSelectedId(item.id)}
                            >
                                {item.name}
                            </button>
                        ))}
                    </div>
                )}
                <div className="mt-4 grid w-full min-w-0 grid-cols-2 gap-3">
                    <button
                        type="button"
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 font-bold text-white disabled:opacity-60"
                        disabled={generating || !posterDataUrl}
                        onClick={download}
                    >
                        <Download className="size-4" />
                        {generating ? (isZh ? '生成中…' : 'Generating…') : isZh ? '保存海报' : 'Save poster'}
                    </button>
                    <button
                        type="button"
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700"
                        onClick={() => void copyText()}
                    >
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        {copied ? (isZh ? '已复制' : 'Copied') : isZh ? '复制文案' : 'Copy text'}
                    </button>
                </div>
            </div>
        </div>
    );
}
