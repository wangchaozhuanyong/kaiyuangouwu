/** Shared persisted contract for merchant artwork. Coordinates are canvas pixels. */
export const POSTER_QR_STYLES = [
    { id: 'minimal', name: '极简圆环', nameEn: 'Minimal ring' },
    { id: 'sunburst', name: '星芒圆盘', nameEn: 'Sunburst' },
    { id: 'aurora', name: '极光轨道', nameEn: 'Aurora orbit' },
    { id: 'champagne', name: '香槟徽章', nameEn: 'Champagne seal' },
    { id: 'jade', name: '翡翠涟漪', nameEn: 'Jade ripple' },
] as const;

export type PosterQrStyle = (typeof POSTER_QR_STYLES)[number]['id'];

export interface ArtworkPosterDesign {
    version: 3;
    canvas: { width: number; height: number };
    qr: {
        shape: 'circle';
        centerX: number;
        centerY: number;
        diameter: number;
        style: PosterQrStyle;
    };
}

export const DEFAULT_ARTWORK_POSTER_DESIGN: ArtworkPosterDesign = {
    version: 3,
    canvas: { width: 1080, height: 1920 },
    qr: { shape: 'circle', centerX: 540, centerY: 1488, diameter: 456, style: 'minimal' },
};

export function isPosterQrStyle(value: unknown): value is PosterQrStyle {
    return POSTER_QR_STYLES.some(style => style.id === value);
}

export function validateArtworkPosterDesign(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '请选择有效的海报设计规格';
    const design = value as Partial<ArtworkPosterDesign>;
    if (design.version !== 3 || !design.canvas || !design.qr) return '海报设计版本无效';
    const { width, height } = design.canvas;
    if (![width, height].every(n => Number.isInteger(n) && n >= 720 && n <= 4096))
        return '画布宽高须为720至4096之间的整数';
    if (width * height > 8388608) return '画布总像素不能超过8388608';
    const { centerX, centerY, diameter, shape, style } = design.qr;
    if (shape !== 'circle' || !isPosterQrStyle(style)) return '请选择有效的圆形二维码样式';
    if (![centerX, centerY, diameter].every(n => Number.isFinite(n) && Number.isInteger(n)))
        return '二维码圆心和直径须为有限整数';
    if (diameter < 360) return '二维码圆形区域直径至少为360像素';
    const radius = diameter / 2;
    if (centerX - radius < 0 || centerY - radius < 0 || centerX + radius > width || centerY + radius > height)
        return '二维码圆形区域必须完整位于画布内';
    return '';
}

export function isArtworkPosterDesign(value: unknown): value is ArtworkPosterDesign {
    return validateArtworkPosterDesign(value) === '';
}
