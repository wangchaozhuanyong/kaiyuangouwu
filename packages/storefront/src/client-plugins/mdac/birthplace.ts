import options from './official-options.json';

const normalize = (value: string) =>
    value
        .normalize('NFKD')
        .toUpperCase()
        .replace(/[^A-Z]/g, '');
const countries: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(
        options.pob.flatMap(([code, label]) => [
            [code, code],
            [normalize(label.slice(code.length + 3)), code],
        ]),
    ),
);
const aliases: Record<string, string> = {
    HONGKONG: 'HKG',
    MACAO: 'MAC',
    MACAU: 'MAC',
    TAIWAN: 'TWN',
    UNITEDSTATES: 'USA',
    UNITEDSTATESOFAMERICA: 'USA',
    UK: 'GBR',
};
// Explicit province/municipality names, never a nationality or document-issuer default.
for (const province of [
    'ANHUI',
    'BEIJING',
    'CHONGQING',
    'FUJIAN',
    'GANSU',
    'GUANGDONG',
    'GUANGXI',
    'GUIZHOU',
    'HAINAN',
    'HEBEI',
    'HEILONGJIANG',
    'HENAN',
    'HUBEI',
    'HUNAN',
    'INNERMONGOLIA',
    'NEIMONGOL',
    'NEIMENGGU',
    'JIANGSU',
    'JIANGXI',
    'JILIN',
    'LIAONING',
    'NINGXIA',
    'QINGHAI',
    'SHAANXI',
    'SHANDONG',
    'SHANGHAI',
    'SHANXI',
    'SICHUAN',
    'TIANJIN',
    'XINJIANG',
    'XIZANG',
    'TIBET',
    'YUNNAN',
    'ZHEJIANG',
])
    aliases[province] = 'CHN';

/** Only an exact place read from the birth field can select an official option. */
export function birthCountry(text: string, confidence: number): string | undefined {
    if (confidence < 85 || !Number.isFinite(confidence)) return;
    // Do not discard extra words/digits to manufacture a place match.
    if (!/^[A-Za-z\s./'-]+$/.test(text.trim())) return;
    const key = normalize(text);
    // Georgia is also a US state; an explicit GEO/USA code is needed to disambiguate.
    if (key === 'GEORGIA') return;
    const code = aliases[key] ?? countries[key];
    return code && !['ZZZ', 'UNO'].includes(code) && Object.hasOwn(countries, code) ? code : undefined;
}

interface OcrWord {
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface BirthRectangle {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Locate the value directly below its label, excluding neighbouring issue/date fields. */
export function birthRectangle(
    words: OcrWord[],
    width: number,
    height: number,
    issuer: string,
): BirthRectangle | undefined {
    const labels: Array<{
        x0: number;
        x1: number;
        y0: number;
        y1: number;
        qualifier: string;
        confidence: number;
    }> = [];
    for (let index = 0; index < words.length - 2; index++) {
        const group = words.slice(index, index + 3);
        if (
            !['PLACE', 'PACE', 'PIACE'].includes(normalize(group[0].text)) ||
            normalize(group[1].text) !== 'OF'
        )
            continue;
        const x0 = Math.min(...group.map(word => word.bbox.x0));
        const x1 = Math.max(...group.map(word => word.bbox.x1));
        const y0 = Math.min(...group.map(word => word.bbox.y0));
        const y1 = Math.max(...group.map(word => word.bbox.y1));
        const maxHeight = Math.max(...group.map(word => word.bbox.y1 - word.bbox.y0));
        if (x1 <= x0 || y1 <= y0 || y1 - y0 > maxHeight * 1.5) continue;
        labels.push({
            x0,
            x1,
            y0,
            y1,
            qualifier: normalize(group[2].text),
            confidence: Math.min(...group.map(word => word.confidence)),
        });
    }
    const matches = labels.filter(label => {
        if (label.confidence < 45) return false;
        if (['BIRTH', 'BIRIH', 'BIRTI', 'BORN'].includes(label.qualifier)) return true;
        // Small English text on Chinese passports can lose the rest of "birth".
        // Require the issuing country's known birth-then-issue layout as well as
        // the readable "Place of b..." prefix; never use the issuer as the value.
        return (
            issuer === 'CHN' &&
            /^B[A-Z]{1,4}$/.test(label.qualifier) &&
            labels.some(
                next =>
                    next !== label &&
                    !next.qualifier.startsWith('B') &&
                    Math.abs(next.x0 - label.x0) < (label.x1 - label.x0) * 0.25 &&
                    next.y0 > label.y1 + (label.y1 - label.y0) &&
                    next.y0 < label.y1 + (label.y1 - label.y0) * 5,
            )
        );
    });
    if (matches.length !== 1) return;
    const match = matches[0];
    const labelWidth = match.x1 - match.x0;
    const left = Math.max(0, Math.floor(match.x0 - labelWidth * 0.15));
    const top = Math.ceil(match.y1 + 1);
    const nextLabelTop = Math.min(
        height,
        ...labels
            .filter(next => next.y0 > match.y1 && Math.abs(next.x0 - match.x0) < labelWidth * 0.5)
            .map(next => next.y0),
    );
    const right = Math.min(width, left + Math.ceil(labelWidth * 1.9));
    const bottom = Math.min(height, nextLabelTop - 1, top + Math.ceil((match.y1 - match.y0) * 2));
    if (right <= left || bottom <= top) return;
    return { left, top, width: right - left, height: bottom - top };
}
