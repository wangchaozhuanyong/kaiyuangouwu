import { randomInt } from 'node:crypto';

export const shopAbuseAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Original 5 × 7 cell outlines: rasterization never asks the host for a font.
const glyphs: Readonly<Record<string, string>> = {
    A: '01110/10001/10001/11111/10001/10001/10001',
    B: '11110/10001/10001/11110/10001/10001/11110',
    C: '01111/10000/10000/10000/10000/10000/01111',
    D: '11110/10001/10001/10001/10001/10001/11110',
    E: '11111/10000/10000/11110/10000/10000/11111',
    F: '11111/10000/10000/11110/10000/10000/10000',
    G: '01111/10000/10000/10111/10001/10001/01111',
    H: '10001/10001/10001/11111/10001/10001/10001',
    J: '00111/00010/00010/00010/10010/10010/01100',
    K: '10001/10010/10100/11000/10100/10010/10001',
    L: '10000/10000/10000/10000/10000/10000/11111',
    M: '10001/11011/10101/10101/10001/10001/10001',
    N: '10001/11001/10101/10011/10001/10001/10001',
    P: '11110/10001/10001/11110/10000/10000/10000',
    Q: '01110/10001/10001/10001/10101/10010/01101',
    R: '11110/10001/10001/11110/10100/10010/10001',
    S: '01111/10000/10000/01110/00001/00001/11110',
    T: '11111/00100/00100/00100/00100/00100/00100',
    U: '10001/10001/10001/10001/10001/10001/01110',
    V: '10001/10001/10001/10001/10001/01010/00100',
    W: '10001/10001/10001/10101/10101/10101/01010',
    X: '10001/10001/01010/00100/01010/10001/10001',
    Y: '10001/10001/01010/00100/00100/00100/00100',
    Z: '11111/00001/00010/00100/01000/10000/11111',
    '2': '01110/10001/00001/00010/00100/01000/11111',
    '3': '11110/00001/00001/01110/00001/00001/11110',
    '4': '00010/00110/01010/10010/11111/00010/00010',
    '5': '11111/10000/10000/11110/00001/00001/11110',
    '6': '01110/10000/10000/11110/10001/10001/01110',
    '7': '11111/00001/00010/00100/01000/01000/01000',
    '8': '01110/10001/10001/01110/10001/10001/01110',
    '9': '01110/10001/10001/01111/00001/00001/01110',
};

function glyphPath(character: string): string {
    const pattern = Object.prototype.hasOwnProperty.call(glyphs, character) ? glyphs[character] : undefined;
    if (!pattern) throw new Error('Unsupported security glyph');
    return pattern
        .split('/')
        .flatMap((row, y) =>
            [...row.matchAll(/1+/g)].map(match => {
                const width = match[0].length * 4;
                return `M${match.index * 4} ${y * 4}h${width}v4h-${width}z`;
            }),
        )
        .join('');
}

/** Server-memory input only. Return only the rasterized PNG to the browser. */
export function renderShopAbuseChallengeSvg(
    answer: string,
    integer: (min: number, max: number) => number = randomInt,
): string {
    if (answer.length !== 6) throw new Error('Invalid security glyph count');
    const characters = [...answer]
        .map((character, index) => {
            const path = glyphPath(character);
            const y = 14 + integer(-5, 6);
            const rotation = integer(-16, 17);
            return `<g transform="translate(${24 + index * 32} ${y}) rotate(${rotation} 10 14)"><path d="${path}"/></g>`;
        })
        .join('');
    const noise = Array.from(
        { length: 6 },
        () =>
            `<path d="M0 ${integer(0, 60)} Q110 ${integer(0, 60)} 232 ${integer(0, 60)}" fill="none" stroke="#95a7b7" stroke-width="1"/>`,
    ).join('');
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="232" height="64">',
        '<rect width="232" height="64" fill="#f3f5f7"/>',
        noise,
        '<g fill="#263b4c">',
        characters,
        '</g></svg>',
    ].join('');
}
