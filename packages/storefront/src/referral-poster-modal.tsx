import { Check, Copy, Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { referralShareUrl } from './referral-attribution';
import { createQrCodeSvgDataUrl } from './share-poster-modal';
import { ReferralPosterTemplate, StorefrontLanguage } from './types';

export interface ReferralPosterStyle {
    id: string;
    nameZh: string;
    nameEn: string;
    colors: [string, string, string];
    background: string;
    foreground: string;
    accent: string;
}

export const referralPosterStyles: ReferralPosterStyle[] = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '品牌简约',
        nameEn: 'Brand minimal',
        colors: ['#fff7ed', '#ffffff', '#fef2f2'],
        background: 'linear-gradient(145deg,#fff7ed,#ffffff 48%,#fef2f2)',
        foreground: '#172033',
        accent: '#dc2626',
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '红金礼遇',
        nameEn: 'Red & gold',
        colors: ['#7f1d1d', '#dc2626', '#991b1b'],
        background: 'linear-gradient(145deg,#7f1d1d,#dc2626 55%,#991b1b)',
        foreground: '#ffffff',
        accent: '#fde68a',
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '生活故事',
        nameEn: 'Lifestyle story',
        colors: ['#ecfdf5', '#f0fdfa', '#dbeafe'],
        background: 'linear-gradient(155deg,#ecfdf5,#f0fdfa 48%,#dbeafe)',
        foreground: '#134e4a',
        accent: '#0f766e',
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '鎏金深色',
        nameEn: 'Premium dark',
        colors: ['#020617', '#172554', '#0f172a'],
        background: 'linear-gradient(145deg,#020617,#172554,#0f172a)',
        foreground: '#f8fafc',
        accent: '#fbbf24',
    },
];

interface PosterView extends ReferralPosterTemplate {
    legacyColors?: [string, string, string];
}

export function ReferralPosterModal({
    inviteCode,
    storefrontName,
    logoUrl,
    language,
    rewardRate,
    templates,
    templateConfigs = [],
    defaultTemplate,
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
    defaultTemplate: string;
    onClose: () => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const styles = useMemo(() => {
        const custom = templateConfigs.filter(template => template.enabled);
        if (custom.length) return custom;
        const enabledLegacy = referralPosterStyles.filter(legacy => templates.includes(legacy.id));
        return (enabledLegacy.length ? enabledLegacy : referralPosterStyles).map(legacy =>
            legacyPosterTemplate(legacy, isZh),
        );
    }, [isZh, templateConfigs, templates]);
    const [selectedId, setSelectedId] = useState(
        styles.some(candidate => candidate.id === defaultTemplate) ? defaultTemplate : (styles[0]?.id ?? ''),
    );
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [posterDataUrl, setPosterDataUrl] = useState('');
    const [generating, setGenerating] = useState(true);
    const [copied, setCopied] = useState(false);
    const style = styles.find(item => item.id === selectedId) ?? styles[0];
    const shareUrl = referralShareUrl(inviteCode, 'POSTER');

    useEffect(() => {
        if (!styles.some(item => item.id === selectedId)) setSelectedId(styles[0]?.id ?? '');
    }, [selectedId, styles]);

    useEffect(() => {
        let cancelled = false;
        void createQrCodeSvgDataUrl(shareUrl)
            .then(value => !cancelled && setQrCodeUrl(value))
            .catch(() => !cancelled && setQrCodeUrl(''));
        return () => {
            cancelled = true;
        };
    }, [shareUrl]);

    useEffect(() => {
        if (!style || !qrCodeUrl) return;
        let cancelled = false;
        setGenerating(true);
        void renderReferralPoster({
            template: style,
            isZh,
            inviteCode,
            storefrontName,
            logoUrl,
            rewardRate,
            qrCodeUrl,
        })
            .then(value => {
                if (!cancelled) setPosterDataUrl(value);
            })
            .catch(() => {
                if (!cancelled) setPosterDataUrl('');
            })
            .finally(() => {
                if (!cancelled) setGenerating(false);
            });
        return () => {
            cancelled = true;
        };
    }, [inviteCode, isZh, logoUrl, qrCodeUrl, rewardRate, storefrontName, style]);

    if (!style) return null;

    const copyText = async () => {
        const headline = localized(style.headlineZh, style.headlineEn, isZh);
        const rewardCopy = replacePosterTokens(
            localized(style.rewardTextZh, style.rewardTextEn, isZh),
            rewardRate,
            storefrontName,
        );
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
            className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/65 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={isZh ? '选择邀请海报' : 'Choose referral poster'}
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl"
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
                <div className="aspect-[2/3] overflow-hidden rounded-[24px] bg-slate-100 shadow-inner">
                    {posterDataUrl && !generating ? (
                        <img
                            className="size-full object-cover"
                            src={posterDataUrl}
                            alt={isZh ? `${style.name}邀请海报预览` : `${style.name} referral poster preview`}
                        />
                    ) : (
                        <div className="grid size-full place-items-center bg-[linear-gradient(145deg,#172554,#7c3aed,#db2777)] text-sm font-bold text-white">
                            {isZh ? '正在生成海报…' : 'Generating poster…'}
                        </div>
                    )}
                </div>
                {styles.length > 1 && (
                    <div
                        className="mt-4 flex gap-2 overflow-x-auto pb-1"
                        role="list"
                        aria-label={isZh ? '海报模板' : 'Poster templates'}
                    >
                        {styles.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold ${
                                    selectedId === item.id
                                        ? 'border-red-500 bg-red-50 text-red-700'
                                        : 'border-slate-200 text-slate-600'
                                }`}
                                onClick={() => setSelectedId(item.id)}
                            >
                                {item.name}
                            </button>
                        ))}
                    </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 font-bold text-white disabled:opacity-60"
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

function legacyPosterTemplate(style: ReferralPosterStyle, isZh: boolean): PosterView {
    return {
        id: style.id,
        name: isZh ? style.nameZh : style.nameEn,
        enabled: true,
        position: referralPosterStyles.findIndex(item => item.id === style.id),
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        titleZh: '好友邀请函',
        titleEn: 'Invitation for friends',
        headlineZh: '好东西，值得和朋友一起分享',
        headlineEn: 'Good things are better shared',
        rewardTextZh: '好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣',
        rewardTextEn: 'Earn {rewardRate}% in rewards when a friend makes a purchase',
        siteIntroZh: '',
        siteIntroEn: '',
        serviceTextZh: '好物严选 · 便捷消费 · 售后服务',
        serviceTextEn: 'Curated products · Easy shopping · Customer support',
        foregroundColor: style.foreground,
        accentColor: style.accent,
        overlayOpacity: style.id === 'BRAND_MINIMAL' || style.id === 'PRODUCT_STORY' ? 0 : 20,
        legacyColors: style.colors,
    };
}

async function renderReferralPoster({
    template,
    isZh,
    inviteCode,
    storefrontName,
    logoUrl,
    rewardRate,
    qrCodeUrl,
}: {
    template: PosterView;
    isZh: boolean;
    inviteCode: string;
    storefrontName: string;
    logoUrl: string | null;
    rewardRate: number;
    qrCodeUrl: string;
}): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1620;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');

    const backgroundUrl = template.posterBackgroundAsset?.source || template.posterBackgroundAsset?.preview;
    if (backgroundUrl) {
        try {
            const background = await loadImage(backgroundUrl, true);
            drawImageCover(context, background, 0, 0, canvas.width, canvas.height);
        } catch {
            paintFallbackBackground(context, template);
        }
    } else {
        paintFallbackBackground(context, template);
    }
    if (template.overlayOpacity > 0) {
        context.fillStyle = `rgba(3,7,18,${template.overlayOpacity / 100})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    const foreground = template.foregroundColor;
    const accent = template.accentColor;
    const font = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillStyle = accent;
    context.font = `800 31px ${font}`;
    context.fillText(localized(template.titleZh, template.titleEn, isZh), 88, 118);

    context.fillStyle = foreground;
    context.font = `900 76px ${font}`;
    const headlineBottom = drawWrappedText(
        context,
        localized(template.headlineZh, template.headlineEn, isZh),
        88,
        220,
        904,
        91,
        3,
    );
    context.globalAlpha = 0.92;
    context.font = `600 30px ${font}`;
    const rewardBottom = drawWrappedText(
        context,
        replacePosterTokens(
            localized(template.rewardTextZh, template.rewardTextEn, isZh),
            rewardRate,
            storefrontName,
        ),
        88,
        headlineBottom + 48,
        904,
        43,
        2,
    );
    const siteIntro = replacePosterTokens(
        localized(template.siteIntroZh, template.siteIntroEn, isZh),
        rewardRate,
        storefrontName,
    );
    if (siteIntro) {
        context.globalAlpha = 0.75;
        context.font = `500 24px ${font}`;
        drawWrappedText(context, siteIntro, 88, rewardBottom + 30, 904, 36, 2);
    }
    context.globalAlpha = 1;

    roundedRect(context, 80, 670, 920, 520, 44);
    context.fillStyle = 'rgba(255,255,255,0.96)';
    context.fill();
    context.fillStyle = '#64748b';
    context.font = `700 23px ${font}`;
    context.fillText(isZh ? '扫码注册或输入邀请码' : 'Scan or enter the invitation code', 130, 750);
    context.font = `500 20px ${font}`;
    context.fillText(
        isZh ? '注册时填写，系统会自动绑定邀请关系' : 'Enter it during registration to link the referral',
        130,
        792,
    );
    const qrImage = await loadImage(qrCodeUrl);
    context.drawImage(qrImage, 130, 842, 292, 292);
    context.fillStyle = '#64748b';
    context.font = `700 21px ${font}`;
    context.fillText(isZh ? '我的邀请码' : 'MY INVITATION CODE', 490, 896);
    context.fillStyle = '#0f172a';
    context.font = '900 48px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.fillText(inviteCode, 490, 968);
    context.fillStyle = accent;
    context.font = `800 23px ${font}`;
    context.fillText(isZh ? '长按识别二维码' : 'Press and hold to scan', 490, 1030);

    const serviceText = localized(template.serviceTextZh, template.serviceTextEn, isZh);
    if (serviceText) {
        roundedRect(context, 80, 1378, 920, 92, 24);
        context.fillStyle = 'rgba(255,255,255,0.14)';
        context.fill();
        context.strokeStyle = 'rgba(255,255,255,0.28)';
        context.lineWidth = 2;
        context.stroke();
        context.fillStyle = foreground;
        context.globalAlpha = 0.92;
        context.textAlign = 'center';
        context.font = `700 24px ${font}`;
        context.fillText(serviceText.slice(0, 52), 540, 1435);
        context.textAlign = 'start';
        context.globalAlpha = 1;
    }

    let brandX = 88;
    if (logoUrl) {
        try {
            const logo = await loadImage(logoUrl, true);
            context.save();
            roundedRect(context, 88, 1500, 56, 56, 15);
            context.clip();
            drawImageCover(context, logo, 88, 1500, 56, 56);
            context.restore();
            brandX = 162;
        } catch {
            // The store name still provides a stable brand signature.
        }
    }
    context.fillStyle = foreground;
    context.globalAlpha = 0.9;
    context.font = `800 25px ${font}`;
    context.fillText(storefrontName.slice(0, 32), brandX, 1538);
    context.globalAlpha = 1;
    return canvas.toDataURL('image/png');
}

function paintFallbackBackground(context: CanvasRenderingContext2D, template: PosterView): void {
    const colors = template.legacyColors ?? ['#111827', '#4f46e5', '#be185d'];
    const gradient = context.createLinearGradient(0, 0, 1080, 1620);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.52, colors[1]);
    gradient.addColorStop(1, colors[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1080, 1620);
    context.globalAlpha = 0.18;
    context.fillStyle = template.accentColor;
    for (const [x, y, radius] of [
        [900, 130, 250],
        [170, 1240, 310],
        [940, 1510, 170],
    ] as const) {
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    }
    context.globalAlpha = 1;
}

function drawImageCover(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = (image.naturalHeight - sourceHeight) / 2;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function roundedRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
): void {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
}

function drawWrappedText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
): number {
    const units = /\s/.test(text) ? text.split(/(\s+)/).filter(Boolean) : Array.from(text);
    const lines: string[] = [];
    let line = '';
    for (const unit of units) {
        const candidate = line + unit;
        if (line && context.measureText(candidate).width > maxWidth) {
            lines.push(line.trimEnd());
            line = unit.trimStart();
            if (lines.length === maxLines) break;
        } else {
            line = candidate;
        }
    }
    if (lines.length < maxLines && line) lines.push(line.trim());
    lines.slice(0, maxLines).forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
    return y + (Math.min(lines.length, maxLines) - 1) * lineHeight;
}

function localized(zh: string, en: string, isZh: boolean): string {
    return (isZh ? zh : en).trim() || (isZh ? en : zh).trim();
}

function replacePosterTokens(text: string, rewardRate: number, storefrontName: string): string {
    return text.replaceAll('{rewardRate}', String(rewardRate)).replaceAll('{storeName}', storefrontName);
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (crossOrigin && !src.startsWith('data:')) image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image unavailable'));
        image.src = src;
    });
}
