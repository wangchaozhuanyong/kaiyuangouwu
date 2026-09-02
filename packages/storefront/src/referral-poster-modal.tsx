import { Check, Copy, Download, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { referralShareUrl } from './referral-attribution';
import { acquireBodyScrollLock } from './scroll-lock';
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
    pattern: ReferralPosterPattern;
}

export type ReferralPosterPattern = 'minimal' | 'glacier' | 'flow' | 'deep-sea' | 'orbit';

export const referralPosterStyles: ReferralPosterStyle[] = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '云桥简约',
        nameEn: 'CloudBridge minimal',
        colors: ['#eef7ff', '#ffffff', '#eaf4ff'],
        background: 'linear-gradient(145deg,#eef7ff,#ffffff 48%,#eaf4ff)',
        foreground: '#0e2a63',
        accent: '#1269e8',
        pattern: 'minimal',
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '冰川蓝光',
        nameEn: 'Glacier blue',
        colors: ['#d9f3ff', '#79c9f4', '#effcff'],
        background: 'linear-gradient(145deg,#d9f3ff,#79c9f4 55%,#effcff)',
        foreground: '#073b66',
        accent: '#008ec4',
        pattern: 'glacier',
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '青空流线',
        nameEn: 'Skyline flow',
        colors: ['#e7fff9', '#b8f1e5', '#dff4ff'],
        background: 'linear-gradient(155deg,#e7fff9,#b8f1e5 48%,#dff4ff)',
        foreground: '#0b4f5c',
        accent: '#0797a5',
        pattern: 'flow',
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '深海科技',
        nameEn: 'Deep-sea tech',
        colors: ['#020b1d', '#0b2857', '#07152f'],
        background: 'linear-gradient(145deg,#020b1d,#0b2857 55%,#07152f)',
        foreground: '#f3f8ff',
        accent: '#59d5ff',
        pattern: 'deep-sea',
    },
    {
        id: 'CLOUD_BRIDGE_ORBIT',
        nameZh: '云桥轨道',
        nameEn: 'CloudBridge orbit',
        colors: ['#f1efff', '#d9e6ff', '#efe3ff'],
        background: 'linear-gradient(145deg,#f1efff,#d9e6ff 48%,#efe3ff)',
        foreground: '#31265f',
        accent: '#6657dc',
        pattern: 'orbit',
    },
];

interface PosterView extends ReferralPosterTemplate {
    legacyColors?: [string, string, string];
    legacyPattern?: ReferralPosterPattern;
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
    const effectiveLogoUrl = logoUrl || '/storefront/cloudbridge-logo.png';
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
        const releaseBodyScrollLock = acquireBodyScrollLock();
        return releaseBodyScrollLock;
    }, []);

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
            logoUrl: effectiveLogoUrl,
            rewardRate,
            qrCodeUrl,
            shareUrl,
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
                <div className="aspect-[9/16] overflow-hidden rounded-[24px] bg-slate-100 shadow-inner">
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
                                        ? 'border-blue-500 bg-blue-50 text-blue-700'
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

function legacyPosterTemplate(style: ReferralPosterStyle, isZh: boolean): PosterView {
    return {
        id: style.id,
        name: isZh ? style.nameZh : style.nameEn,
        enabled: true,
        position: referralPosterStyles.findIndex(item => item.id === style.id),
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        titleZh: 'AI 工具一站式服务',
        titleEn: 'One-stop AI service',
        headlineZh: '热门 AI 工具\n一站轻松获取',
        headlineEn: 'Popular AI tools\nmade easy',
        rewardTextZh: '好友成功消费，可获得 {rewardRate}% 奖励用于消费抵扣',
        rewardTextEn: 'Earn {rewardRate}% in rewards when a friend makes a purchase',
        siteIntroZh: 'ChatGPT、Claude、Gemini、Codex 等\n热门 AI 服务，一个网站轻松了解与选择',
        siteIntroEn: 'ChatGPT, Claude, Gemini, Codex and more\nExplore practical AI services in one place',
        serviceTextZh: '好物严选 · 便捷消费 · 售后服务',
        serviceTextEn: 'Curated products · Easy shopping · Customer support',
        featureOneTitleZh: '热门工具汇集',
        featureOneTitleEn: '精选 AI tools',
        featureOneTextZh: '多种 AI 工具任你选',
        featureOneTextEn: 'A curated set of AI tools',
        featureTwoTitleZh: '便捷开通服务',
        featureTwoTitleEn: 'Fast activation',
        featureTwoTextZh: '快速开通 省时省心',
        featureTwoTextEn: 'Get started in a few clicks',
        featureThreeTitleZh: '专属售后支持',
        featureThreeTitleEn: 'Dedicated support',
        featureThreeTextZh: '专业客服 贴心服务',
        featureThreeTextEn: 'Friendly help when you need it',
        qrEyebrowZh: '扫码访问云桥 AI',
        qrEyebrowEn: 'Scan CloudBridge AI',
        qrTitleZh: '发现更多实用 AI 服务',
        qrTitleEn: 'Discover practical AI services',
        qrDescriptionZh: '满足多种 AI 使用场景',
        qrDescriptionEn: 'Tools for work, creativity, learning and code',
        sceneOneZh: '办公提效',
        sceneOneEn: 'Work',
        sceneTwoZh: '内容创作',
        sceneTwoEn: 'Create',
        sceneThreeZh: '学习辅助',
        sceneThreeEn: 'Learn',
        sceneFourZh: '智能编程',
        sceneFourEn: 'Code',
        ctaTextZh: '长按识别二维码，立即进入云桥 AI',
        ctaTextEn: 'Press and hold to enter CloudBridge AI',
        footerTitleZh: '让好用的 AI，真正为你所用',
        footerTitleEn: 'AI that works for you',
        footerTextZh: '热门 AI 工具与数字服务一站式平台',
        footerTextEn: 'One-stop platform for AI tools and digital services',
        foregroundColor: style.foreground,
        accentColor: style.accent,
        overlayOpacity: style.id === 'BRAND_MINIMAL' || style.id === 'PRODUCT_STORY' ? 0 : 20,
        legacyColors: style.colors,
        legacyPattern: style.pattern,
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
    shareUrl,
}: {
    template: PosterView;
    isZh: boolean;
    inviteCode: string;
    storefrontName: string;
    logoUrl: string | null;
    rewardRate: number;
    qrCodeUrl: string;
    shareUrl: string;
}): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');

    const backgroundUrl = template.posterBackgroundAsset?.source || template.posterBackgroundAsset?.preview;
    const palette = mobilePalette(template);
    paintMobileCloudBridgeBackground(context, palette);
    drawMobileHeroOrnament(context, palette);
    if (backgroundUrl) {
        try {
            const background = await loadImage(backgroundUrl, true);
            context.save();
            context.globalAlpha = Math.max(0.06, Math.min(0.18, (100 - template.overlayOpacity) / 700));
            drawImageCover(context, background, 700, 760, 340, 520);
            context.restore();
        } catch {
            // A custom background is optional; the built-in CloudBridge treatment remains usable.
        }
    }

    const isDarkSkin = palette.pattern === 'deep-sea';
    const foreground = posterForegroundColor(template.foregroundColor, palette.pattern);
    const accent = palette.accent;
    const cardSurface = isDarkSkin ? 'rgba(8,28,62,0.88)' : 'rgba(255,255,255,0.9)';
    const cardBorder = isDarkSkin ? 'rgba(89,213,255,0.42)' : 'rgba(126,180,247,0.45)';
    const muted = isDarkSkin ? '#c7dcf5' : '#38558a';
    const font = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    context.textBaseline = 'alphabetic';
    const domain = getShareDomain(shareUrl);
    const brand = localized(template.titleZh, template.titleEn, isZh) || storefrontName;

    // 01. Brand block
    try {
        const logo = await loadImage(logoUrl || '/storefront/cloudbridge-logo.png', true);
        context.save();
        roundedRect(context, 74, 72, 106, 106, 28);
        context.clip();
        context.fillStyle = '#ffffff';
        context.fill();
        drawImageContain(context, logo, 86, 84, 82, 82);
        context.restore();
    } catch {
        drawCloudBridgeMark(context, 127, 125, 44, accent);
    }
    context.fillStyle = foreground;
    context.font = `900 42px ${font}`;
    context.fillText(storefrontName.slice(0, 20), 204, 119);
    context.fillStyle = accent;
    context.font = `600 24px ${font}`;
    context.fillText(domain, 206, 154);
    roundedRect(context, 744, 90, 270, 62, 31);
    context.strokeStyle = accent;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = accent;
    context.font = `700 23px ${font}`;
    context.textAlign = 'center';
    context.fillText(brand || (isZh ? 'AI 工具一站式服务' : 'One-stop AI services'), 879, 130);
    context.textAlign = 'start';

    // 02. Hero block
    context.fillStyle = foreground;
    context.font = `950 86px ${font}`;
    const headlineBottom = drawWrappedText(
        context,
        localized(template.headlineZh, template.headlineEn, isZh),
        74,
        300,
        930,
        102,
        3,
    );
    context.fillStyle = accent;
    context.globalAlpha = 0.95;
    context.font = `700 28px ${font}`;
    const siteIntro = replacePosterTokens(
        localized(template.siteIntroZh, template.siteIntroEn, isZh),
        rewardRate,
        storefrontName,
    );
    drawWrappedText(context, siteIntro, 78, headlineBottom + 66, 900, 42, 3);
    context.globalAlpha = 1;

    // 03. Three feature cards
    const features = [
        [
            template.featureOneTitleZh,
            template.featureOneTitleEn,
            template.featureOneTextZh,
            template.featureOneTextEn,
            'grid',
        ],
        [
            template.featureTwoTitleZh,
            template.featureTwoTitleEn,
            template.featureTwoTextZh,
            template.featureTwoTextEn,
            'bolt',
        ],
        [
            template.featureThreeTitleZh,
            template.featureThreeTitleEn,
            template.featureThreeTextZh,
            template.featureThreeTextEn,
            'headset',
        ],
    ] as const;
    features.forEach(([titleZh, titleEn, textZh, textEn, icon], index) => {
        const y = 610 + index * 156;
        roundedRect(context, 70, y, 940, 132, 28);
        context.fillStyle = cardSurface;
        context.fill();
        context.strokeStyle = cardBorder;
        context.lineWidth = 2;
        context.stroke();
        drawFeatureIcon(context, icon, 130, y + 66, accent);
        context.fillStyle = foreground;
        context.font = `850 32px ${font}`;
        context.fillText(localized(titleZh, titleEn, isZh), 220, y + 57);
        context.fillStyle = muted;
        context.font = `600 24px ${font}`;
        context.fillText(localized(textZh, textEn, isZh), 220, y + 96);
    });

    // 04. QR information block
    roundedRect(context, 70, 1110, 940, 360, 30);
    context.fillStyle = isDarkSkin ? 'rgba(8,28,62,0.92)' : 'rgba(255,255,255,0.92)';
    context.fill();
    context.strokeStyle = isDarkSkin ? 'rgba(89,213,255,0.5)' : 'rgba(126,180,247,0.55)';
    context.lineWidth = 2;
    context.stroke();
    const qrImage = await loadImage(qrCodeUrl);
    if (isDarkSkin) {
        roundedRect(context, 100, 1142, 286, 286, 20);
        context.fillStyle = '#ffffff';
        context.fill();
    }
    context.drawImage(qrImage, 108, 1150, 270, 270);
    context.fillStyle = foreground;
    context.font = `650 24px ${font}`;
    context.fillText(localized(template.qrEyebrowZh, template.qrEyebrowEn, isZh), 438, 1188);
    context.fillStyle = accent;
    context.font = `900 40px ${font}`;
    const qrTitleBottom = drawWrappedText(
        context,
        localized(template.qrTitleZh, template.qrTitleEn, isZh),
        438,
        1245,
        510,
        48,
        2,
    );
    context.fillStyle = foreground;
    context.font = `650 24px ${font}`;
    drawWrappedText(
        context,
        localized(template.qrDescriptionZh, template.qrDescriptionEn, isZh),
        438,
        qrTitleBottom + 46,
        510,
        34,
        2,
    );
    context.fillStyle = muted;
    context.font = `550 20px ${font}`;
    drawWrappedText(
        context,
        replacePosterTokens(
            localized(template.rewardTextZh, template.rewardTextEn, isZh),
            rewardRate,
            storefrontName,
        ),
        438,
        1338,
        510,
        28,
        1,
    );
    context.fillStyle = accent;
    context.font = `800 27px ${font}`;
    context.fillText(domain, 438, 1382);
    const scenes = [
        [template.sceneOneZh, template.sceneOneEn],
        [template.sceneTwoZh, template.sceneTwoEn],
        [template.sceneThreeZh, template.sceneThreeEn],
        [template.sceneFourZh, template.sceneFourEn],
    ] as const;
    scenes.forEach(([zh, en], index) => {
        const x = 438 + index * 135;
        drawSceneIcon(context, x + 28, 1420, index, accent);
        context.fillStyle = foreground;
        context.font = `650 18px ${font}`;
        context.textAlign = 'center';
        context.fillText(localized(zh, en, isZh), x + 28, 1462);
    });
    context.textAlign = 'start';

    // 05. CTA and footer
    roundedRect(context, 70, 1520, 940, 122, 61);
    const ctaGradient = context.createLinearGradient(70, 1520, 1010, 1642);
    ctaGradient.addColorStop(0, palette.cta[0]);
    ctaGradient.addColorStop(1, palette.cta[1]);
    context.fillStyle = ctaGradient;
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = `850 32px ${font}`;
    context.textAlign = 'center';
    context.fillText(localized(template.ctaTextZh, template.ctaTextEn, isZh), 540, 1597);
    context.textAlign = 'start';
    drawCloudBridgeMark(context, 540, 1740, 42, accent);
    context.fillStyle = foreground;
    context.font = `900 34px ${font}`;
    context.textAlign = 'center';
    context.fillText(localized(template.footerTitleZh, template.footerTitleEn, isZh), 540, 1810);
    context.fillStyle = accent;
    context.font = `700 28px ${font}`;
    context.fillText(domain, 540, 1858);
    context.fillStyle = muted;
    context.font = `600 21px ${font}`;
    context.fillText(localized(template.footerTextZh, template.footerTextEn, isZh), 540, 1897);
    context.textAlign = 'start';
    return canvas.toDataURL('image/png');
}

interface MobilePosterPalette {
    background: [string, string, string];
    accent: string;
    pattern: ReferralPosterPattern;
    cta: [string, string];
}

const posterPatternCta: Record<ReferralPosterPattern, [string, string]> = {
    minimal: ['#1257d6', '#18b7df'],
    glacier: ['#0077b6', '#63d6ff'],
    flow: ['#087f8c', '#2fc59d'],
    'deep-sea': ['#16468e', '#10a9c7'],
    orbit: ['#5546c7', '#9175ea'],
};

function paintMobileCloudBridgeBackground(
    context: CanvasRenderingContext2D,
    palette: MobilePosterPalette,
): void {
    const gradient = context.createLinearGradient(0, 0, 1080, 1920);
    gradient.addColorStop(0, palette.background[0]);
    gradient.addColorStop(0.48, palette.background[1]);
    gradient.addColorStop(1, palette.background[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1080, 1920);
    context.save();
    if (palette.pattern === 'minimal') {
        context.globalAlpha = 0.11;
        context.fillStyle = palette.accent;
        for (const [x, y, radius] of [
            [970, 230, 210],
            [100, 1730, 250],
        ] as const) {
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
        }
        context.globalAlpha = 0.08;
        for (let x = 54; x < 1080; x += 54) {
            for (let y = 40; y < 1920; y += 54) {
                context.beginPath();
                context.arc(x, y, 2, 0, Math.PI * 2);
                context.fill();
            }
        }
    } else if (palette.pattern === 'glacier') {
        const shards = [
            [720, -80, 1040, 360],
            [820, 300, 1160, 720],
            [-120, 1420, 330, 1980],
            [120, 1550, 520, 2000],
        ] as const;
        shards.forEach(([left, top, right, bottom], index) => {
            context.globalAlpha = index % 2 ? 0.18 : 0.28;
            context.fillStyle = index % 2 ? '#ffffff' : palette.accent;
            context.beginPath();
            context.moveTo(left, top);
            context.lineTo(right, top + 80);
            context.lineTo(right - 90, bottom);
            context.lineTo(left + 70, bottom - 110);
            context.closePath();
            context.fill();
        });
    } else if (palette.pattern === 'flow') {
        context.strokeStyle = palette.accent;
        context.lineCap = 'round';
        for (let index = 0; index < 7; index += 1) {
            const y = 180 + index * 270;
            context.globalAlpha = 0.1 + (index % 3) * 0.035;
            context.lineWidth = 12 - (index % 3) * 2;
            context.beginPath();
            context.moveTo(-140, y);
            context.bezierCurveTo(180, y - 180, 700, y + 210, 1220, y - 100);
            context.stroke();
        }
    } else if (palette.pattern === 'deep-sea') {
        context.strokeStyle = palette.accent;
        context.lineWidth = 2;
        context.globalAlpha = 0.12;
        for (let x = 0; x <= 1080; x += 72) {
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, 1920);
            context.stroke();
        }
        for (let y = 0; y <= 1920; y += 72) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(1080, y);
            context.stroke();
        }
        drawCornerNetwork(context, 82, 1660, palette.accent, 0.5);
        drawCornerNetwork(context, 920, 1810, palette.accent, 0.38);
    } else {
        context.strokeStyle = palette.accent;
        context.lineWidth = 3;
        context.globalAlpha = 0.18;
        for (const [x, y, radius] of [
            [930, 250, 260],
            [150, 1690, 320],
            [960, 1790, 210],
        ] as const) {
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.stroke();
        }
        context.fillStyle = palette.accent;
        for (let x = 50; x < 1080; x += 86) {
            for (let y = 50; y < 1920; y += 86) {
                context.beginPath();
                context.arc(x, y, 3, 0, Math.PI * 2);
                context.fill();
            }
        }
    }
    context.restore();
    context.globalAlpha = 1;
}

function mobilePalette(template: PosterView): MobilePosterPalette {
    const colors = template.legacyColors;
    const accent = accentColorForTemplate(template);
    const pattern = template.legacyPattern ?? 'minimal';
    if (colors?.length === 3 && colors.every(color => /^#[0-9A-F]{6}$/i.test(color))) {
        return { background: colors, accent, pattern, cta: posterPatternCta[pattern] };
    }
    return {
        background: ['#eef7ff', '#ffffff', '#eaf4ff'],
        accent,
        pattern,
        cta: [accent, '#18b7df'],
    };
}

function accentColorForTemplate(template: PosterView): string {
    return /^#[0-9A-F]{6}$/i.test(template.accentColor) ? template.accentColor : '#1269E8';
}

function drawMobileHeroOrnament(context: CanvasRenderingContext2D, palette: MobilePosterPalette): void {
    const centerX = 875;
    const centerY = 282;
    const accent = palette.accent;
    const secondary = palette.background[1];
    context.save();
    context.globalAlpha = 0.22;
    const glow = context.createRadialGradient(centerX, centerY, 12, centerX, centerY, 244);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.42, secondary);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(centerX, centerY, 244, 0, Math.PI * 2);
    context.fill();

    if (palette.pattern === 'minimal') {
        context.globalAlpha = 0.72;
        context.fillStyle = 'rgba(255,255,255,0.86)';
        context.beginPath();
        context.arc(centerX, centerY, 112, 0, Math.PI * 2);
        context.fill();
        drawCloudBridgeMark(context, centerX, centerY, 82, accent);
        context.restore();
        return;
    }

    if (palette.pattern === 'glacier') {
        context.globalAlpha = 0.78;
        context.strokeStyle = accent;
        context.fillStyle = 'rgba(255,255,255,0.72)';
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(centerX, centerY - 128);
        context.lineTo(centerX + 112, centerY - 28);
        context.lineTo(centerX + 54, centerY + 126);
        context.lineTo(centerX - 108, centerY + 72);
        context.lineTo(centerX - 74, centerY - 72);
        context.closePath();
        context.fill();
        context.stroke();
        context.beginPath();
        context.moveTo(centerX, centerY - 128);
        context.lineTo(centerX - 12, centerY + 18);
        context.lineTo(centerX + 112, centerY - 28);
        context.moveTo(centerX - 12, centerY + 18);
        context.lineTo(centerX + 54, centerY + 126);
        context.moveTo(centerX - 12, centerY + 18);
        context.lineTo(centerX - 108, centerY + 72);
        context.stroke();
        context.restore();
        return;
    }

    if (palette.pattern === 'flow') {
        context.globalAlpha = 0.62;
        context.strokeStyle = accent;
        context.lineCap = 'round';
        for (let index = 0; index < 4; index += 1) {
            context.lineWidth = 11 - index * 2;
            context.beginPath();
            context.moveTo(centerX - 190, centerY - 70 + index * 45);
            context.bezierCurveTo(
                centerX - 60,
                centerY - 180 + index * 28,
                centerX + 55,
                centerY + 150 - index * 25,
                centerX + 190,
                centerY - 58 + index * 36,
            );
            context.stroke();
        }
        context.restore();
        return;
    }

    if (palette.pattern === 'deep-sea') {
        context.globalAlpha = 0.82;
        context.strokeStyle = accent;
        context.fillStyle = 'rgba(4,18,43,0.9)';
        context.lineWidth = 6;
        roundedRect(context, centerX - 82, centerY - 82, 164, 164, 34);
        context.fill();
        context.stroke();
        for (const offset of [-116, -52, 52, 116]) {
            context.beginPath();
            context.moveTo(centerX + offset, centerY - 150);
            context.lineTo(centerX + offset, centerY - 104);
            context.moveTo(centerX + offset, centerY + 104);
            context.lineTo(centerX + offset, centerY + 150);
            context.stroke();
        }
        drawCloudBridgeMark(context, centerX, centerY, 74, accent);
        context.restore();
        return;
    }

    context.globalAlpha = 0.4;
    context.strokeStyle = accent;
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(centerX, centerY, 190, 68, -0.28, 0, Math.PI * 2);
    context.ellipse(centerX, centerY, 154, 102, 0.48, 0, Math.PI * 2);
    context.stroke();

    context.globalAlpha = 0.58;
    context.strokeStyle = secondary;
    context.lineWidth = 12;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(centerX - 154, centerY + 74);
    context.bezierCurveTo(
        centerX - 62,
        centerY - 8,
        centerX + 14,
        centerY + 120,
        centerX + 158,
        centerY + 34,
    );
    context.stroke();

    context.globalAlpha = 0.86;
    context.fillStyle = '#ffffff';
    context.strokeStyle = accent;
    context.lineWidth = 5;
    roundedRect(context, centerX - 48, centerY - 44, 96, 88, 24);
    context.fill();
    context.stroke();
    context.globalAlpha = 0.85;
    context.strokeStyle = accent;
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(centerX - 22, centerY + 8);
    context.lineTo(centerX - 4, centerY - 12);
    context.lineTo(centerX + 8, centerY + 2);
    context.lineTo(centerX + 26, centerY - 18);
    context.moveTo(centerX - 27, centerY + 22);
    context.lineTo(centerX + 27, centerY + 22);
    context.stroke();

    for (const [x, y, radius] of [
        [centerX - 176, centerY + 72, 11],
        [centerX + 164, centerY + 32, 13],
        [centerX + 118, centerY - 102, 9],
    ] as const) {
        context.globalAlpha = 0.92;
        context.fillStyle = '#ffffff';
        context.strokeStyle = accent;
        context.lineWidth = 4;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.stroke();
    }
    context.restore();
}

function drawCornerNetwork(
    context: CanvasRenderingContext2D,
    originX: number,
    originY: number,
    color: string,
    alpha: number,
): void {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([5, 7]);
    const points = [
        [originX, originY],
        [originX + 108, originY - 52],
        [originX + 198, originY - 16],
        [originX + 256, originY - 98],
        [originX + 320, originY - 42],
    ] as const;
    context.beginPath();
    points.slice(1).forEach(([x, y]) => {
        context.moveTo(originX, originY);
        context.lineTo(x, y);
    });
    context.stroke();
    context.setLineDash([]);
    points.forEach(([x, y], index) => {
        context.fillStyle = index === 0 ? '#ffffff' : color;
        context.beginPath();
        context.arc(x, y, index === 0 ? 8 : 5, 0, Math.PI * 2);
        context.fill();
    });
    context.restore();
}

function getShareDomain(shareUrl: string): string {
    try {
        if (typeof window !== 'undefined' && window.location.host) return window.location.host;
        return new URL(shareUrl).host || 'damatong.net';
    } catch {
        return 'damatong.net';
    }
}

function readableForeground(value: string): string {
    if (!/^#[0-9A-F]{6}$/i.test(value)) return '#0E2A63';
    const normalized = value.slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return red + green + blue > 630 ? '#0E2A63' : value;
}

export function posterForegroundColor(value: string, pattern: ReferralPosterPattern): string {
    return pattern === 'deep-sea' ? validHexColor(value, '#f3f8ff') : readableForeground(value);
}

function validHexColor(value: string, fallback: string): string {
    return /^#[0-9A-F]{6}$/i.test(value) ? value : fallback;
}

function drawImageContain(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(
        image,
        x + (width - drawWidth) / 2,
        y + (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
    );
}

function drawCloudBridgeMark(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    size: number,
    color: string,
): void {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = 'rgba(255,255,255,0.8)';
    context.lineWidth = Math.max(4, size / 9);
    context.lineCap = 'round';
    context.beginPath();
    context.arc(centerX - size * 0.22, centerY, size * 0.34, Math.PI * 0.9, Math.PI * 1.92);
    context.arc(centerX + size * 0.14, centerY - size * 0.1, size * 0.42, Math.PI * 1.04, Math.PI * 1.96);
    context.arc(centerX + size * 0.4, centerY + size * 0.02, size * 0.25, Math.PI * 1.12, Math.PI * 1.92);
    context.stroke();
    context.beginPath();
    context.moveTo(centerX - size * 0.45, centerY + size * 0.1);
    context.lineTo(centerX - size * 0.12, centerY + size * 0.1);
    context.lineTo(centerX - size * 0.12, centerY + size * 0.42);
    context.moveTo(centerX + size * 0.15, centerY + size * 0.08);
    context.lineTo(centerX + size * 0.15, centerY + size * 0.42);
    context.stroke();
    context.restore();
}

function drawFeatureIcon(
    context: CanvasRenderingContext2D,
    icon: 'grid' | 'bolt' | 'headset',
    centerX: number,
    centerY: number,
    color: string,
): void {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 8;
    context.lineCap = 'round';
    if (icon === 'grid') {
        for (const [x, y] of [
            [-24, -24],
            [8, -24],
            [-24, 8],
            [8, 8],
        ] as const) {
            roundedRect(context, centerX + x, centerY + y, 26, 26, 6);
            context.fill();
        }
    } else if (icon === 'bolt') {
        context.beginPath();
        context.moveTo(centerX + 12, centerY - 40);
        context.lineTo(centerX - 25, centerY + 4);
        context.lineTo(centerX - 3, centerY + 4);
        context.lineTo(centerX - 14, centerY + 42);
        context.lineTo(centerX + 28, centerY - 10);
        context.lineTo(centerX + 7, centerY - 10);
        context.closePath();
        context.fill();
    } else {
        context.beginPath();
        context.arc(centerX, centerY + 2, 33, Math.PI, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(centerX - 33, centerY + 2);
        context.lineTo(centerX - 33, centerY + 25);
        context.lineTo(centerX - 18, centerY + 25);
        context.moveTo(centerX + 33, centerY + 2);
        context.lineTo(centerX + 33, centerY + 25);
        context.lineTo(centerX + 18, centerY + 25);
        context.stroke();
        context.beginPath();
        context.arc(centerX + 8, centerY + 34, 6, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function drawSceneIcon(
    context: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    index: number,
    color: string,
): void {
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (index === 0) {
        context.rect(centerX - 16, centerY - 18, 32, 36);
        context.moveTo(centerX - 9, centerY - 10);
        context.lineTo(centerX + 9, centerY - 10);
        context.moveTo(centerX - 9, centerY);
        context.lineTo(centerX + 9, centerY);
    } else if (index === 1) {
        context.moveTo(centerX - 18, centerY + 14);
        context.lineTo(centerX + 18, centerY - 18);
        context.moveTo(centerX - 12, centerY - 17);
        context.lineTo(centerX - 20, centerY - 17);
        context.lineTo(centerX - 20, centerY - 9);
        context.moveTo(centerX + 12, centerY + 8);
        context.lineTo(centerX + 20, centerY + 8);
        context.lineTo(centerX + 20, centerY);
    } else if (index === 2) {
        context.moveTo(centerX - 20, centerY - 15);
        context.lineTo(centerX + 20, centerY - 15);
        context.lineTo(centerX + 20, centerY + 15);
        context.lineTo(centerX - 20, centerY + 15);
        context.closePath();
        context.moveTo(centerX - 12, centerY - 24);
        context.lineTo(centerX + 12, centerY - 24);
    } else {
        context.moveTo(centerX - 18, centerY - 8);
        context.lineTo(centerX - 5, centerY + 4);
        context.lineTo(centerX + 18, centerY - 20);
        context.moveTo(centerX - 18, centerY + 20);
        context.lineTo(centerX + 18, centerY + 20);
    }
    context.stroke();
    context.restore();
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
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
        if (lines.length >= maxLines) break;
        const units = /\s/.test(paragraph) ? paragraph.split(/(\s+)/).filter(Boolean) : Array.from(paragraph);
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
    }
    lines.slice(0, maxLines).forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
    return lines.length ? y + (Math.min(lines.length, maxLines) - 1) * lineHeight : y;
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
