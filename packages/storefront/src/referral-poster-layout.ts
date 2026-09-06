import QRCode from 'qrcode';

export type PosterCopyBase =
    | 'title'
    | 'headline'
    | 'siteIntro'
    | 'featureOneTitle'
    | 'featureOneText'
    | 'featureTwoTitle'
    | 'featureTwoText'
    | 'featureThreeTitle'
    | 'featureThreeText'
    | 'qrEyebrow'
    | 'qrTitle'
    | 'qrDescription'
    | 'rewardText'
    | 'sceneOne'
    | 'sceneTwo'
    | 'sceneThree'
    | 'sceneFour'
    | 'ctaText'
    | 'footerTitle'
    | 'footerText'
    | 'serviceText';
export type PosterCopyField = `${PosterCopyBase}${'Zh' | 'En'}`;
export type PosterCopy = Record<PosterCopyField, string>;
export interface PosterDesign {
    version?: number;
    background?: string;
    muted?: string;
    panel?: string;
    border?: string;
    number?: string;
    button?: string;
    buttonEnd?: string;
    buttonInk?: string;
}
export interface PosterRenderTemplate extends PosterCopy {
    id: string;
    name: string;
    enabled: boolean;
    position: number;
    layoutVariant: string;
    updatedAt?: string;
    posterBackgroundAsset: { id: string; source: string; preview: string } | null;
    shareBackgroundAsset?: { id: string; source: string; preview: string } | null;
    foregroundColor: string;
    accentColor: string;
    overlayOpacity: number;
    design?: PosterDesign | null;
}
export const posterLayoutFields = [
    {
        id: 'brand',
        label: '品牌名',
        field: 'storefrontName',
        x: 72,
        y: 125,
        size: 43,
        lines: 1,
        lineHeight: 0,
        width: 520,
        anchor: 'start',
    },
    {
        id: 'domain',
        label: '网站地址',
        field: 'shareUrl.hostname',
        x: 1008,
        y: 147,
        size: 25,
        lines: 1,
        lineHeight: 0,
        width: 360,
        anchor: 'end',
    },
    {
        id: 'tag',
        label: '顶部定位',
        field: 'titleZh',
        x: 1008,
        y: 101,
        size: 26,
        lines: 1,
        lineHeight: 0,
        width: 360,
        anchor: 'end',
    },
    {
        id: 'headline',
        label: '主标题',
        field: 'headlineZh',
        x: 540,
        y: 330,
        size: 100,
        lines: 2,
        lineHeight: 116,
        width: 936,
        anchor: 'middle',
    },
    {
        id: 'intro',
        label: '服务介绍',
        field: 'siteIntroZh',
        x: 540,
        y: 527,
        size: 30,
        lines: 2,
        lineHeight: 46,
        width: 925,
        anchor: 'middle',
    },
    {
        id: 'feature1',
        label: '卖点一标题',
        field: 'featureOneTitleZh',
        x: 166,
        y: 717,
        size: 38,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'feature1desc',
        label: '卖点一说明',
        field: 'featureOneTextZh',
        x: 166,
        y: 767,
        size: 28,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'feature2',
        label: '卖点二标题',
        field: 'featureTwoTitleZh',
        x: 166,
        y: 865,
        size: 38,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'feature2desc',
        label: '卖点二说明',
        field: 'featureTwoTextZh',
        x: 166,
        y: 915,
        size: 28,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'feature3',
        label: '卖点三标题',
        field: 'featureThreeTitleZh',
        x: 166,
        y: 1013,
        size: 38,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'feature3desc',
        label: '卖点三说明',
        field: 'featureThreeTextZh',
        x: 166,
        y: 1063,
        size: 28,
        lines: 1,
        lineHeight: 0,
        width: 448,
        anchor: 'start',
    },
    {
        id: 'qrlabel',
        label: '扫码区引导',
        field: 'qrEyebrowZh',
        x: 432,
        y: 1209,
        size: 26,
        lines: 1,
        lineHeight: 0,
        width: 540,
        anchor: 'start',
    },
    {
        id: 'qrtitle',
        label: '扫码区标题',
        field: 'qrTitleZh',
        x: 432,
        y: 1271,
        size: 45,
        lines: 1,
        lineHeight: 0,
        width: 540,
        anchor: 'start',
    },
    {
        id: 'qrdesc',
        label: '扫码区说明',
        field: 'qrDescriptionZh',
        x: 432,
        y: 1324,
        size: 29,
        lines: 2,
        lineHeight: 42,
        width: 540,
        anchor: 'start',
    },
    {
        id: 'reward',
        label: '邀请奖励',
        field: 'rewardTextZh',
        x: 432,
        y: 1426,
        size: 25,
        lines: 2,
        lineHeight: 37,
        width: 540,
        anchor: 'start',
    },
    {
        id: 'scene1',
        label: '场景一',
        field: 'sceneOneZh',
        x: 185,
        y: 1588,
        size: 27,
        lines: 1,
        lineHeight: 0,
        width: 195,
        anchor: 'middle',
    },
    {
        id: 'scene2',
        label: '场景二',
        field: 'sceneTwoZh',
        x: 421,
        y: 1588,
        size: 27,
        lines: 1,
        lineHeight: 0,
        width: 195,
        anchor: 'middle',
    },
    {
        id: 'scene3',
        label: '场景三',
        field: 'sceneThreeZh',
        x: 658,
        y: 1588,
        size: 27,
        lines: 1,
        lineHeight: 0,
        width: 195,
        anchor: 'middle',
    },
    {
        id: 'scene4',
        label: '场景四',
        field: 'sceneFourZh',
        x: 895,
        y: 1588,
        size: 27,
        lines: 1,
        lineHeight: 0,
        width: 195,
        anchor: 'middle',
    },
    {
        id: 'cta',
        label: '识别二维码指令',
        field: 'ctaTextZh',
        x: 540,
        y: 1710,
        size: 36,
        lines: 1,
        lineHeight: 0,
        width: 890,
        anchor: 'middle',
    },
    {
        id: 'footer',
        label: '品牌收尾',
        field: 'footerTitleZh',
        x: 540,
        y: 1823,
        size: 39,
        lines: 1,
        lineHeight: 0,
        width: 940,
        anchor: 'middle',
    },
    {
        id: 'footnote',
        label: '页脚服务定位',
        field: 'footerTextZh',
        x: 540,
        y: 1877,
        size: 27,
        lines: 1,
        lineHeight: 0,
        width: 940,
        anchor: 'middle',
    },
] as const;
export const POSTER_LAYOUT_VERSION = 2;
const FONT = '"PingFang SC", "Microsoft YaHei", -apple-system, sans-serif';

export function replacePosterTokens(text: string, rewardRate: number, storeName: string): string {
    return text.replaceAll('{rewardRate}', String(rewardRate)).replaceAll('{storeName}', storeName);
}
export function posterDomain(shareUrl: string): string {
    const url = new URL(shareUrl);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid store URL');
    return url.host;
}
export function posterRenderKey(input: {
    channelId: string;
    shareUrl: string;
    language: string;
    storefrontName: string;
    logoUrl: string | null;
    rewardRate: number;
    template: PosterRenderTemplate;
}): string {
    return JSON.stringify([
        POSTER_LAYOUT_VERSION,
        input.channelId,
        input.shareUrl,
        input.language,
        input.storefrontName,
        input.logoUrl,
        input.rewardRate,
        input.template,
    ]);
}
export function availablePosterTemplates(
    systemIds: string[],
    system: PosterRenderTemplate[],
    custom: PosterRenderTemplate[],
): PosterRenderTemplate[] {
    return [...system.filter(t => t.enabled && systemIds.includes(t.id)), ...custom.filter(t => t.enabled)];
}
const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
    const cached = imageCache.get(url);
    if (cached) return cached;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (!url.startsWith('data:')) image.crossOrigin = 'anonymous';
        const timer = setTimeout(() => reject(new Error('Image loading timed out')), 15000);
        image.onload = () => {
            clearTimeout(timer);
            resolve(image);
        };
        image.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Poster image unavailable'));
        };
        image.src = url;
    }).catch(error => {
        if (imageCache.get(url) === promise) imageCache.delete(url);
        throw error;
    });
    const oldestUrl = imageCache.keys().next().value;
    if (imageCache.size >= 24 && oldestUrl !== undefined) imageCache.delete(oldestUrl);
    imageCache.set(url, promise);
    return promise;
}
function color(value: string | undefined, fallback: string): string {
    return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function rect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
    fill: string | CanvasGradient,
    border?: string,
) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = border;
        ctx.stroke();
    }
}
export function wrapPosterText(
    ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
    text: string,
    width: number,
): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        let line = '';
        for (const token of paragraph.split(/(\s+)/).filter(Boolean)) {
            if (ctx.measureText(line + token).width <= width) {
                line += token;
                continue;
            }
            if (line.trim()) {
                lines.push(line.trim());
                line = '';
            }
            if (ctx.measureText(token).width <= width) {
                line = token.trimStart();
                continue;
            }
            for (const char of Array.from(token)) {
                if (ctx.measureText(line + char).width > width && line) {
                    lines.push(line);
                    line = '';
                }
                line += char;
            }
        }
        lines.push(line.trim());
    }
    return lines;
}
export async function renderReferralPoster(input: {
    template: PosterRenderTemplate;
    storefrontName: string;
    logoUrl: string | null;
    isZh: boolean;
    rewardRate: number;
    shareUrl: string;
    showSafeArea?: boolean;
}): Promise<string> {
    const { template, storefrontName, isZh, rewardRate, shareUrl } = input;
    const domain = posterDomain(shareUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const ink = color(template.foregroundColor, '#152c49');
    const accent = color(template.accentColor, '#2565ae');
    const rgb = [1, 3, 5].map(n => parseInt(ink.slice(n, n + 2), 16));
    const dark = rgb.reduce((a, b) => a + b, 0) / 3 > 165;
    const design = template.design ?? {};
    // Custom templates have one accent control. Lift it for small text on dark panels,
    // while keeping the original saturated color for the call-to-action background.
    const accentRgb = [1, 3, 5].map(n => parseInt(accent.slice(n, n + 2), 16));
    const textAccent =
        !template.design && dark
            ? '#' +
              accentRgb
                  .map(v =>
                      Math.round(v + (255 - v) * 0.4)
                          .toString(16)
                          .padStart(2, '0'),
                  )
                  .join('')
            : accent;
    const buttonInk = accentRgb.reduce((a, b) => a + b, 0) / 3 > 165 ? '#152c49' : '#ffffff';
    const background = color(design.background, dark ? '#030617' : '#f5f9fe');
    const panel = color(design.panel, dark ? '#0b1430' : '#ffffff');
    const border = color(design.border, dark ? '#354279' : '#d5e2f0');
    const muted = color(design.muted, dark ? '#b8c8e5' : '#62758c');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 1080, 1920);
    const backgroundUrl = template.posterBackgroundAsset?.source || template.posterBackgroundAsset?.preview;
    if (backgroundUrl) {
        const image = await loadImage(backgroundUrl);
        // The complete managed background includes the bounded ornament, never any copy or QR.
        const ratio = Math.max(1080 / image.naturalWidth, 1920 / image.naturalHeight);
        ctx.drawImage(
            image,
            (1080 - image.naturalWidth * ratio) / 2,
            (1920 - image.naturalHeight * ratio) / 2,
            image.naturalWidth * ratio,
            image.naturalHeight * ratio,
        );
    }
    if (template.overlayOpacity > 0) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(80, template.overlayOpacity) / 100})`;
        ctx.fillRect(0, 0, 1080, 1920);
    }
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(72, 189);
    ctx.lineTo(1008, 189);
    ctx.stroke();
    [656, 804, 952].forEach((y, index) => {
        rect(ctx, 72, y, 555, 132, 24, panel, border);
        rect(ctx, 94, y + 28, 51, 51, 14, color(design.number, dark ? '#292753' : '#e5effb'));
        ctx.font = `600 26px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = textAccent;
        ctx.fillText(`0${index + 1}`, 120, y + 63);
    });
    rect(ctx, 70, 1140, 940, 368, 30, panel, border);
    rect(ctx, 100, 1177, 288, 288, 12, '#ffffff');
    const qrSvg = await QRCode.toString(shareUrl, {
        type: 'svg',
        width: 276,
        margin: 4,
        errorCorrectionLevel: 'M',
        color: { dark: '#071022', light: '#ffffff' },
    });
    const qr = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`);
    ctx.drawImage(qr, 106, 1183, 276, 276);
    [72, 309, 546, 783].forEach(x => rect(ctx, x, 1544, 225, 65, 18, panel, border));
    const gradient = ctx.createLinearGradient(70, 0, 1010, 0);
    gradient.addColorStop(0, color(design.button, accent));
    gradient.addColorStop(1, color(design.buttonEnd, accent));
    rect(ctx, 70, 1640, 940, 112, 56, gradient);
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(380, 1779);
    ctx.lineTo(700, 1779);
    ctx.stroke();
    let logo: HTMLImageElement | undefined;
    if (input.logoUrl) {
        try {
            logo = await loadImage(input.logoUrl);
        } catch {
            /* Use the current store wordmark when its optional logo is unavailable. */
        }
    }
    if (logo) {
        const scale = Math.min(64 / logo.naturalWidth, 64 / logo.naturalHeight);
        ctx.drawImage(
            logo,
            72 + (64 - logo.naturalWidth * scale) / 2,
            78 + (64 - logo.naturalHeight * scale) / 2,
            logo.naturalWidth * scale,
            logo.naturalHeight * scale,
        );
    }
    const overflow: string[] = [];
    for (const field of posterLayoutFields) {
        const key = field.field.replace(/Zh$/, isZh ? 'Zh' : 'En') as PosterCopyField;
        const value =
            field.id === 'brand'
                ? storefrontName
                : field.id === 'domain'
                  ? domain
                  : field.id === 'reward' && rewardRate <= 0
                    ? ''
                    : replacePosterTokens(template[key] ?? '', rewardRate, storefrontName);
        const x = field.id === 'brand' && logo ? 155 : field.x;
        const width = field.id === 'brand' && logo ? 460 : field.width;
        const weight = ['brand', 'headline', 'qrtitle', 'footer', 'cta'].includes(field.id)
            ? 700
            : field.id.startsWith('feature') && !field.id.endsWith('desc')
              ? 600
              : 400;
        const maxSize = field.id === 'headline' ? 100 : field.size;
        const minSize =
            field.id === 'headline'
                ? 56
                : field.id === 'domain'
                  ? 16
                  : field.id === 'brand'
                    ? 22
                    : Math.min(22, field.size);
        let lines: string[] = [];
        let size = maxSize;
        for (; size >= minSize; size--) {
            ctx.font = `${weight} ${size}px ${FONT}`;
            lines = wrapPosterText(ctx, value, width);
            if (lines.length <= field.lines && lines.every(line => ctx.measureText(line).width <= width))
                break;
        }
        if (size < minSize) {
            overflow.push(isZh ? field.label : field.field);
            continue;
        }
        ctx.textAlign = field.anchor === 'middle' ? 'center' : field.anchor === 'end' ? 'right' : 'left';
        ctx.fillStyle =
            field.id === 'cta'
                ? color(design.buttonInk, buttonInk)
                : ['tag', 'qrtitle', 'reward'].includes(field.id)
                  ? textAccent
                  : ['intro', 'domain', 'qrdesc', 'footnote'].includes(field.id) || field.id.endsWith('desc')
                    ? muted
                    : ink;
        lines.forEach((line, index) => ctx.fillText(line, x, field.y + index * field.lineHeight));
    }
    if (overflow.length)
        throw new Error((isZh ? '请缩短以下文案：' : 'Shorten these fields: ') + overflow.join('、'));
    if (input.showSafeArea) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(656, 635, 352, 450);
        ctx.setLineDash([]);
    }
    return canvas.toDataURL('image/png');
}
