import { Check, Copy, Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { referralShareUrl } from './referral-attribution';
import { createQrCodeSvgDataUrl } from './share-poster-modal';
import { StorefrontLanguage } from './types';

export interface ReferralPosterStyle {
    id: string;
    nameZh: string;
    nameEn: string;
    background: string;
    foreground: string;
    accent: string;
    eyebrowZh: string;
    eyebrowEn: string;
}

export const referralPosterStyles: ReferralPosterStyle[] = [
    {
        id: 'BRAND_MINIMAL',
        nameZh: '品牌简约',
        nameEn: 'Brand minimal',
        background: 'linear-gradient(145deg,#fff7ed,#ffffff 48%,#fef2f2)',
        foreground: '#172033',
        accent: '#dc2626',
        eyebrowZh: '好友专属邀请',
        eyebrowEn: 'An invitation for friends',
    },
    {
        id: 'BENEFIT_RED_GOLD',
        nameZh: '红金礼遇',
        nameEn: 'Red & gold',
        background:
            'radial-gradient(circle at 75% 12%,#fbbf24 0,transparent 22%),linear-gradient(145deg,#7f1d1d,#dc2626 55%,#991b1b)',
        foreground: '#ffffff',
        accent: '#fde68a',
        eyebrowZh: '一起发现好物',
        eyebrowEn: 'Discover something special',
    },
    {
        id: 'PRODUCT_STORY',
        nameZh: '生活故事',
        nameEn: 'Lifestyle story',
        background: 'linear-gradient(155deg,#ecfdf5,#f0fdfa 48%,#dbeafe)',
        foreground: '#134e4a',
        accent: '#0f766e',
        eyebrowZh: '把喜欢分享给你',
        eyebrowEn: 'Sharing something I love',
    },
    {
        id: 'PREMIUM_DARK',
        nameZh: '鎏金深色',
        nameEn: 'Premium dark',
        background:
            'radial-gradient(circle at 85% 0,#713f12 0,transparent 28%),linear-gradient(145deg,#020617,#172554)',
        foreground: '#f8fafc',
        accent: '#fbbf24',
        eyebrowZh: '会员邀请计划',
        eyebrowEn: 'Member invitation program',
    },
];

export function ReferralPosterModal({
    inviteCode,
    storefrontName,
    logoUrl,
    language,
    rewardRate,
    templates,
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
    defaultTemplate: string;
    onClose: () => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const availableStyles = referralPosterStyles.filter(posterStyle => templates.includes(posterStyle.id));
    const styles = availableStyles.length ? availableStyles : referralPosterStyles;
    const [selectedId, setSelectedId] = useState(
        styles.some(posterStyle => posterStyle.id === defaultTemplate) ? defaultTemplate : styles[0].id,
    );
    const [qrCodeUrl, setQrCodeUrl] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const style = styles.find(item => item.id === selectedId) ?? styles[0];
    const shareUrl = referralShareUrl(inviteCode, 'POSTER');
    const templateButtonClass = (templateId: string) =>
        `rounded-xl border px-1 py-2 text-[11px] font-bold ${
            selectedId === templateId
                ? 'border-red-500 bg-red-50 text-red-700'
                : 'border-slate-200 text-slate-600'
        }`;

    useEffect(() => {
        let cancelled = false;
        void createQrCodeSvgDataUrl(shareUrl)
            .then(value => !cancelled && setQrCodeUrl(value))
            .catch(() => !cancelled && setQrCodeUrl(''));
        return () => {
            cancelled = true;
        };
    }, [shareUrl]);

    const copyText = async () => {
        const message = isZh
            ? `${storefrontName} 邀请你来逛逛\n我的邀请码：${inviteCode}\n${shareUrl}`
            : `${storefrontName} invitation\nMy invitation code: ${inviteCode}\n${shareUrl}`;
        try {
            await navigator.clipboard.writeText(message);
            setCopied(true);
            onNotify(isZh ? '分享文案已复制' : 'Share message copied');
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            onNotify(isZh ? '复制失败，请手动复制邀请链接' : 'Could not copy the share message');
        }
    };

    const download = async () => {
        setDownloading(true);
        try {
            const canvas = document.createElement('canvas');
            const scale = 2;
            canvas.width = 720 * scale;
            canvas.height = 1080 * scale;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Canvas unavailable');
            context.scale(scale, scale);
            paintPosterBackground(context, style);

            context.fillStyle = style.foreground;
            context.font = '700 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(storefrontName.slice(0, 24), 64, 92);
            context.fillStyle = style.accent;
            context.font = '700 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(isZh ? style.eyebrowZh : style.eyebrowEn, 64, 146);

            context.fillStyle = style.foreground;
            context.font = '800 54px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            wrapCanvasText(
                context,
                isZh ? '好东西，值得和朋友一起分享' : 'Good things are better shared',
                64,
                244,
                590,
                70,
            );
            context.globalAlpha = 0.76;
            context.font = '400 23px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(
                isZh
                    ? `好友下单后，我可获得 ${rewardRate}% 消费奖励`
                    : `${rewardRate}% spending reward after a friend orders`,
                64,
                435,
            );
            context.globalAlpha = 1;

            roundedRect(context, 64, 512, 592, 426, 34);
            context.fillStyle = '#ffffff';
            context.fill();
            context.fillStyle = '#0f172a';
            context.font = '700 18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(isZh ? '扫码注册或输入邀请码' : 'Scan or enter the invitation code', 104, 580);
            context.fillStyle = '#64748b';
            context.font = '500 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(
                isZh
                    ? '注册时填写，系统会自动绑定邀请关系'
                    : 'Enter it during registration to link the referral',
                104,
                616,
            );

            if (qrCodeUrl) {
                const qrImage = await loadImage(qrCodeUrl);
                context.drawImage(qrImage, 104, 662, 190, 190);
            }
            context.fillStyle = '#0f172a';
            context.font = '600 16px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(isZh ? '我的邀请码' : 'MY INVITATION CODE', 354, 700);
            context.font = '800 36px ui-monospace, SFMono-Regular, Menlo, monospace';
            context.fillText(inviteCode, 354, 754);
            context.fillStyle = style.accent;
            context.font = '700 17px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(isZh ? '长按识别二维码' : 'Press and hold to scan', 354, 812);

            if (logoUrl) {
                try {
                    const logo = await loadImage(logoUrl, true);
                    context.drawImage(logo, 64, 970, 48, 48);
                } catch {
                    // A remote logo can reject CORS; the branded text remains.
                }
            }
            context.fillStyle = style.foreground;
            context.globalAlpha = 0.75;
            context.font = '500 17px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
            context.fillText(storefrontName, logoUrl ? 128 : 64, 1002);
            context.globalAlpha = 1;

            const anchor = document.createElement('a');
            anchor.download = `${storefrontName}-${isZh ? '邀请海报' : 'referral-poster'}-${style.id}.png`;
            anchor.href = canvas.toDataURL('image/png');
            anchor.click();
            onNotify(isZh ? '邀请海报已保存' : 'Referral poster saved');
        } catch {
            onNotify(isZh ? '海报生成失败，请复制邀请链接分享' : 'Could not generate the poster');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm"
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
                    className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-white/90 text-slate-600 shadow"
                    onClick={onClose}
                    aria-label={isZh ? '关闭' : 'Close'}
                >
                    <X className="size-4" />
                </button>
                <div
                    className="aspect-[2/3] overflow-hidden rounded-[24px] p-7 shadow-inner"
                    style={{ background: style.background, color: style.foreground }}
                >
                    <p
                        className="m-0 text-xs font-extrabold uppercase tracking-[0.2em]"
                        style={{ color: style.accent }}
                    >
                        {isZh ? style.eyebrowZh : style.eyebrowEn}
                    </p>
                    <h2 className="mt-5 max-w-[280px] text-[32px] font-black leading-[1.1] tracking-tight">
                        {isZh ? '好东西，值得和朋友一起分享' : 'Good things are better shared'}
                    </h2>
                    <p className="mt-4 text-sm opacity-75">
                        {isZh
                            ? `好友下单后，我可获得 ${rewardRate}% 消费奖励`
                            : `${rewardRate}% spending reward after a friend orders`}
                    </p>
                    <div className="mt-8 grid grid-cols-[112px_1fr] items-center gap-4 rounded-3xl bg-white p-4 text-slate-900 shadow-xl">
                        {qrCodeUrl ? (
                            <img
                                className="size-28 rounded-xl"
                                src={qrCodeUrl}
                                alt={isZh ? '邀请二维码' : 'Invitation QR code'}
                            />
                        ) : (
                            <div className="size-28 animate-pulse rounded-xl bg-slate-100" />
                        )}
                        <div>
                            <small className="font-semibold text-slate-500">
                                {isZh ? '我的邀请码' : 'INVITATION CODE'}
                            </small>
                            <strong className="mt-2 block break-all font-mono text-xl tracking-wider">
                                {inviteCode}
                            </strong>
                            <span className="mt-3 block text-xs font-bold" style={{ color: style.accent }}>
                                {isZh ? '扫码立即注册' : 'Scan to register'}
                            </span>
                        </div>
                    </div>
                    <p className="mt-7 text-sm font-bold opacity-80">{storefrontName}</p>
                </div>
                <div
                    className="mt-4 grid grid-cols-4 gap-2"
                    role="list"
                    aria-label={isZh ? '海报模板' : 'Poster templates'}
                >
                    {styles.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            className={templateButtonClass(item.id)}
                            onClick={() => setSelectedId(item.id)}
                        >
                            {isZh ? item.nameZh : item.nameEn}
                        </button>
                    ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-3 font-bold text-white disabled:opacity-60"
                        disabled={downloading}
                        onClick={() => void download()}
                    >
                        <Download className="size-4" />
                        {downloading ? (isZh ? '生成中…' : 'Generating…') : isZh ? '保存海报' : 'Save poster'}
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

function paintPosterBackground(context: CanvasRenderingContext2D, style: ReferralPosterStyle): void {
    const dark = style.id === 'PREMIUM_DARK';
    const red = style.id === 'BENEFIT_RED_GOLD';
    const story = style.id === 'PRODUCT_STORY';
    const gradient = context.createLinearGradient(0, 0, 720, 1080);
    gradient.addColorStop(0, dark ? '#020617' : red ? '#7f1d1d' : story ? '#ecfdf5' : '#fff7ed');
    gradient.addColorStop(0.55, dark ? '#172554' : red ? '#dc2626' : story ? '#f0fdfa' : '#ffffff');
    gradient.addColorStop(1, dark ? '#0f172a' : red ? '#991b1b' : story ? '#dbeafe' : '#fef2f2');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 720, 1080);
    context.globalAlpha = 0.14;
    context.fillStyle = style.accent;
    context.beginPath();
    context.arc(620, 120, 170, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
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

function wrapCanvasText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
): void {
    const characters = Array.from(text);
    let line = '';
    let lineIndex = 0;
    for (const character of characters) {
        if (context.measureText(line + character).width > maxWidth && line) {
            context.fillText(line, x, y + lineIndex * lineHeight);
            line = character;
            lineIndex += 1;
        } else {
            line += character;
        }
    }
    if (line) context.fillText(line, x, y + lineIndex * lineHeight);
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (crossOrigin) image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Image unavailable'));
        image.src = src;
    });
}
