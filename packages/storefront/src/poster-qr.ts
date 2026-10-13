// organize-imports-ignore -- Keep the shared type contract with the QR dependency.
import QRCode from 'qrcode';

import { isPosterQrStyle, type PosterQrStyle } from '../../common/src/referral-poster-design';

/**
 * Circular artwork: round finders and five module treatments, with a matching circular dot field.
 * Peripheral marks are decoration, not encoded URL data. The one-module gap is an artistic
 * compatibility tradeoff, not the standard four-module quiet zone; keep decoder coverage.
 */
export function createCircularQrSvg(value: string, style: PosterQrStyle, D: number): string {
    if (!isPosterQrStyle(style)) throw new Error('二维码样式无效');
    if (!value || !Number.isInteger(D) || D < 1 || D > 4096) throw new Error('二维码内容或尺寸无效');
    const qr = QRCode.create(value, { errorCorrectionLevel: 'H' });
    const N = qr.modules.size;
    const cell = Math.floor((D * 0.58) / N);
    if (cell < 4)
        throw Object.assign(new Error('二维码区域太小，无法清晰显示此链接，请增大圆形区域'), {
            errorCode: 'POSTER_QR_TOO_SMALL',
        });
    const start = (D - N * cell) / 2;
    const center = D / 2;
    const quiet = 1;
    const outerRadius = D * 0.465;
    const color = {
        minimal: '#142a2d',
        sunburst: '#203744',
        aurora: '#393b71',
        champagne: '#614525',
        jade: '#194a3d',
    }[style];
    // FNV-1a integer hashing keeps decorative marks stable for the same link.
    /* eslint-disable no-bitwise -- This deterministic 32-bit hash requires XOR and unsigned coercion. */
    let seed = 2166136261;
    for (const c of value) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    const rng = (x: number, y: number) =>
        (((Math.imul(x + 1000, 73856093) ^ Math.imul(y + 1000, 19349663) ^ seed) >>> 0) % 100) / 100;
    /* eslint-enable no-bitwise */
    const finder = (x: number, y: number) =>
        (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
    const active = (x: number, y: number) =>
        x >= 0 && x < N && y >= 0 && y < N && !finder(x, y) && qr.modules.get(y, x);
    const dot = (cx: number, cy: number, s: number, mode: PosterQrStyle) => {
        if (mode === 'champagne')
            return `<rect x="${cx - s * 0.47}" y="${cy - s * 0.47}" width="${s * 0.94}" height="${s * 0.94}" rx="${s * 0.29}" transform="rotate(45 ${cx} ${cy})"/>`;
        if (mode === 'jade')
            return [
                `<path d="M${cx - s * 0.515} ${cy - s * 0.515}H${cx}`,
                `Q${cx + s * 0.515} ${cy - s * 0.515} ${cx + s * 0.515} ${cy}V${cy + s * 0.515}H${cx}`,
                `Q${cx - s * 0.515} ${cy + s * 0.515} ${cx - s * 0.515} ${cy}Z"/>`,
            ].join('');
        return `<circle cx="${cx}" cy="${cy}" r="${s * 0.54}"/>`;
    };
    const parts: string[] = [];
    // Decorative dots continue the module rhythm to a circular silhouette.
    for (let y = -N; y < 2 * N; y++)
        for (let x = -N; x < 2 * N; x++) {
            if (x >= -quiet && x < N + quiet && y >= -quiet && y < N + quiet) continue;
            const cx = start + (x + 0.5) * cell;
            const cy = start + (y + 0.5) * cell;
            if (Math.hypot(cx - center, cy - center) > outerRadius - cell * 0.7 || rng(x, y) > 0.53) continue;
            if (style === 'sunburst') {
                const angle = Math.atan2(cy - center, cx - center);
                const length = cell * (rng(x + 1, y + 2) > 0.55 ? 1.7 : 0.7);
                const r0 = Math.hypot(cx - center, cy - center) - length / 2;
                const r1 = r0 + length;
                const xa = center + Math.cos(angle) * r0;
                const ya = center + Math.sin(angle) * r0;
                const xb = center + Math.cos(angle) * r1;
                const yb = center + Math.sin(angle) * r1;
                if (
                    Math.min(Math.abs(xa - center), Math.abs(xb - center)) < (N * cell) / 2 + cell &&
                    Math.min(Math.abs(ya - center), Math.abs(yb - center)) < (N * cell) / 2 + cell
                )
                    continue;
                parts.push(
                    `<path d="M${xa} ${ya}L${xb} ${yb}" stroke="${color}" stroke-width="${cell * 0.62}" stroke-linecap="round"/>`,
                );
            } else if (style === 'aurora') {
                if (rng(x, y + 1) > 0.6)
                    parts.push(
                        `<rect x="${cx - cell * 0.38}" y="${cy - cell * 0.6}" width="${cell * 0.76}" height="${cell * 1.2}" rx="${cell * 0.38}"/>`,
                    );
                else parts.push(dot(cx, cy, cell * 0.944, 'minimal'));
            } else parts.push(dot(cx, cy, cell, style));
        }
    for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
            if (!active(x, y)) continue;
            const px = start + x * cell;
            const py = start + y * cell;
            if (qr.modules.isReserved(y, x)) {
                parts.push(`<rect x="${px}" y="${py}" width="${cell}" height="${cell}"/>`);
                continue;
            }
            if (style === 'sunburst' || style === 'aurora') {
                const horizontal = style === 'sunburst';
                const next = horizontal ? active(x + 1, y) : active(x, y + 1);
                if (next)
                    parts.push(
                        horizontal
                            ? `<rect x="${px + cell * 0.5}" y="${py + cell * 0.03}" width="${cell}" height="${cell * 0.94}"/>`
                            : `<rect x="${px + cell * 0.03}" y="${py + cell * 0.5}" width="${cell * 0.94}" height="${cell}"/>`,
                    );
                parts.push(dot(px + cell * 0.5, py + cell * 0.5, cell, 'minimal'));
            } else parts.push(dot(px + cell * 0.5, py + cell * 0.5, cell, style));
        }
    for (const [x, y] of [
        [0, 0],
        [N - 7, 0],
        [0, N - 7],
    ]) {
        const cx = start + (x + 3.5) * cell;
        const cy = start + (y + 3.5) * cell;
        parts.push(
            `<circle cx="${cx}" cy="${cy}" r="${3.5 * cell}"/>`,
            `<circle cx="${cx}" cy="${cy}" r="${2.5 * cell}" fill="#fff"/>`,
            `<circle cx="${cx}" cy="${cy}" r="${1.5 * cell}"/>`,
        );
    }
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}">`,
        `<circle cx="${center}" cy="${center}" r="${center}" fill="#fff"/>`,
        `<g fill="${color}">${parts.join('')}</g></svg>`,
    ].join('');
}

export function createCircularQrSvgDataUrl(value: string, style: PosterQrStyle, diameter: number): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(createCircularQrSvg(value, style, diameter))}`;
}
