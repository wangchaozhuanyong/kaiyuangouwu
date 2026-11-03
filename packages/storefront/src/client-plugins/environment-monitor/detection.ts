import { checks, scoreContributions, type CheckId, type Copy } from './content';

export interface BrowserSignals {
    timezone: string | null;
    offset: number | null;
    languages: string[] | null;
    script: string | null;
    locale: string | null;
    cjkFonts: string[] | null;
    vendorFonts: string[] | null;
    browserToken: string | null;
    deviceToken: string | null;
    emoji: string | null;
    browser: string | null;
    platform: string | null;
}
export interface BrowserReport {
    checkedAt: string;
    signals: BrowserSignals;
    score: number | null;
    contributions: Array<number | null>;
    ratios: Array<number | null>;
    coverage: number;
    inAppBrowser: boolean | null;
}
export const signalIds: ReadonlyArray<keyof BrowserSignals> = [
    'timezone',
    'languages',
    'script',
    'cjkFonts',
    'vendorFonts',
    'browserToken',
    'deviceToken',
    'locale',
    'offset',
    'emoji',
    'browser',
    'platform',
];
export const simplifiedFonts = [
    'Microsoft YaHei',
    'Microsoft JhengHei',
    'PingFang SC',
    'Hiragino Sans GB',
    'STHeiti',
    'STSong',
    'SimSun',
    'SimHei',
    'Noto Sans CJK SC',
    'Source Han Sans SC',
    'WenQuanYi Micro Hei',
];
export const traditionalFonts = [
    'PingFang TC',
    'Heiti TC',
    'Hiragino Sans CNS',
    'Noto Sans CJK TC',
    'Source Han Sans TC',
    'MingLiU',
    'PMingLiU',
];
export const vendorFonts = [
    'MiSans',
    'HarmonyOS Sans',
    'HarmonyOS Sans SC',
    'OPPO Sans',
    'OPPOSans',
    'vivo Sans',
    'Honor Sans',
    'Alibaba PuHuiTi',
    'WPS Fangzheng',
    'FZLanTingHeiS',
];
const browserTokens = [
    'micromessenger',
    'qqbrowser',
    'mqqbrowser',
    'quark',
    'ucbrowser',
    'ucweb',
    'baiduboxapp',
    'baidubrowser',
    'miuibrowser',
    'mibrowser',
    'huaweibrowser',
    'heytapbrowser',
    'oppobrowser',
    'vivobrowser',
    '360se',
    '360ee',
    'qihoobrowser',
    'sogoumobilebrowser',
    '2345browser',
    'lbbrowser',
];
const deviceTokens = [
    'harmonyos',
    'huawei',
    'honor',
    'xiaomi',
    'redmi',
    'oppo',
    'vivo',
    'realme',
    'oneplus',
    'miui',
];
const mainland = new Set([
    'Asia/Shanghai',
    'Asia/Urumqi',
    'Asia/Chongqing',
    'Asia/Chungking',
    'Asia/Harbin',
    'Asia/Kashgar',
    'PRC',
]);
const otherChinese = new Set(['Asia/Hong_Kong', 'Asia/Macau', 'Asia/Macao', 'Asia/Taipei']);
const finite = (n: number | null): n is number => n !== null && Number.isFinite(n);

/** Reference-compatible per-item heuristics. Regional preferences are not account-risk probabilities. */
export function scoreBrowserSignals(s: BrowserSignals, inAppBrowser: boolean | null = null): BrowserReport {
    const simplifiedCount = s.cjkFonts?.filter(font => simplifiedFonts.includes(font)).length ?? 0;
    const traditionalCount = s.cjkFonts?.filter(font => traditionalFonts.includes(font)).length ?? 0;
    // Alias names represent one font family; do not double-count HarmonyOS / OPPO spelling variants.
    const vendorCount = new Set(
        s.vendorFonts?.map(font =>
            /harmonyos/i.test(font) ? 'harmonyos' : /oppo/i.test(font) ? 'oppo' : font.toLowerCase(),
        ),
    ).size;
    const languageList = s.languages?.join(',').toLowerCase();
    const ratios: Array<number | null> = [
        s.timezone === null
            ? null
            : mainland.has(s.timezone)
              ? 1
              : otherChinese.has(s.timezone)
                ? 0.6
                : /asia/i.test(s.timezone)
                  ? 0.35
                  : 0,
        s.languages === null
            ? null
            : /^zh/i.test(s.languages[0] ?? '')
              ? 1
              : /zh|cn/.test(languageList ?? '')
                ? 0.5
                : 0,
        s.script === null ? null : /Hans|Hant/.test(s.script) ? 1 : 0,
        s.cjkFonts === null
            ? null
            : simplifiedCount
              ? Math.min(1, 0.75 + 0.08 * simplifiedCount)
              : traditionalCount
                ? 0.5
                : 0,
        s.vendorFonts === null ? null : vendorCount >= 2 ? 1 : vendorCount === 1 ? 0.8 : 0,
        s.browserToken === null ? null : s.browserToken ? 1 : 0,
        s.deviceToken === null ? null : /^harmonyos$/i.test(s.deviceToken) ? 1 : s.deviceToken ? 0.7 : 0,
        s.locale === null ? null : /zh-cn|zh-hans|^zh$/i.test(s.locale) ? 1 : /^zh/i.test(s.locale) ? 0.5 : 0,
        !finite(s.offset) ? null : s.offset === 480 ? 0.7 : s.offset >= 420 && s.offset <= 540 ? 0.4 : 0,
        s.emoji === null
            ? null
            : s.emoji === 'Apple'
              ? 0.2
              : /Windows|Android|HarmonyOS/.test(s.emoji)
                ? 0.4
                : 0,
        s.browser === null ? null : 0,
        s.platform === null ? null : 0,
    ];
    return {
        checkedAt: new Date().toISOString(),
        signals: s,
        ratios,
        ...scoreContributions(ratios),
        coverage: signalIds.filter(key => s[key] !== null).length,
        inAppBrowser,
    };
}
function read<T>(operation: () => T): T | null {
    try {
        return operation();
    } catch {
        return null;
    }
}
function matchToken(source: string, tokens: readonly string[]) {
    return tokens.find(token => source.toLowerCase().includes(token)) ?? '';
}

/** Text-width probe only, matching the reference candidate lists. No pixels, downloaded fonts or persisted fingerprint. */
export function measureFonts(doc: Document): { cjkFonts: string[] | null; vendorFonts: string[] | null } {
    const unknown = { cjkFonts: null, vendorFonts: null };
    try {
        const context = doc.createElement('canvas').getContext('2d');
        if (!context) return unknown;
        const text = '中文字体检测ABCabc012';
        const fallbacks = ['monospace', 'sans-serif', 'serif'];
        const widths = fallbacks.map(font => {
            context.font = `72px ${font}`;
            return context.measureText(text).width;
        });
        if (widths.some(width => !Number.isFinite(width) || width <= 0)) return unknown;
        const installed = (font: string) =>
            fallbacks.some((fallback, index) => {
                context.font = `72px "${font}", ${fallback}`;
                const width = context.measureText(text).width;
                if (!Number.isFinite(width) || width <= 0) throw new Error('Font measurement unavailable');
                return Math.abs(width - widths[index]) > 0.5;
            });
        return {
            cjkFonts: [...simplifiedFonts, ...traditionalFonts].filter(installed),
            vendorFonts: vendorFonts.filter(installed),
        };
    } catch {
        return unknown;
    }
}
export interface CollectOptions {
    signal?: AbortSignal;
    onProgress?: (completed: number, id: CheckId) => void;
    only?: CheckId;
    previous?: BrowserReport;
}
export async function collectBrowserReport(options: CollectOptions = {}): Promise<BrowserReport> {
    const { signal, onProgress } = options;
    signal?.throwIfAborted();
    // Yield one paint before CPU font measurements; no simulated progress or minimum scan duration.
    if (typeof requestAnimationFrame === 'function')
        await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 100);
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    clearTimeout(timer);
                    resolve();
                }),
            );
        });
    signal?.throwIfAborted();
    const s: BrowserSignals = options.previous
        ? { ...options.previous.signals }
        : {
              timezone: null,
              offset: null,
              languages: null,
              script: null,
              locale: null,
              cjkFonts: null,
              vendorFonts: null,
              browserToken: null,
              deviceToken: null,
              emoji: null,
              browser: null,
              platform: null,
          };
    let ua: string | null | undefined;
    let platform: string | null | undefined;
    let brands: string | null | undefined;
    let fontResult: ReturnType<typeof measureFonts> | undefined;
    let inAppBrowser = options.previous?.inAppBrowser ?? null;
    const getUa = () => (ua === undefined ? (ua = read(() => navigator.userAgent || null)) : ua);
    const getPlatform = () =>
        platform === undefined
            ? (platform = read(() => {
                  const hints = navigator as Navigator & { userAgentData?: { platform?: string } };
                  return hints.userAgentData?.platform || navigator.platform || '';
              }))
            : platform;
    const getBrands = () =>
        brands === undefined
            ? (brands = read(() => {
                  const hints = navigator as Navigator & {
                      userAgentData?: { brands?: Array<{ brand: string; version: string }> };
                  };
                  return hints.userAgentData?.brands?.map(item => item.brand).join(' ') ?? '';
              }))
            : brands;
    const readers: Record<CheckId, () => void> = {
        timezone: () => {
            s.timezone = read(() => new Intl.DateTimeFormat().resolvedOptions().timeZone || null);
        },
        language: () => {
            s.languages = read(() => {
                const list = Array.from(
                    navigator.languages?.length ? navigator.languages : [navigator.language],
                ).filter(Boolean);
                return list.length ? list : null;
            });
        },
        languageVariant: () => {
            const list = options.only
                ? read(() =>
                      Array.from(
                          navigator.languages?.length ? navigator.languages : [navigator.language],
                      ).filter(Boolean),
                  )
                : s.languages;
            s.script =
                list === null
                    ? null
                    : list.some(value => /zh-(tw|hk|mo)|zh-hant/i.test(value))
                      ? 'Hant'
                      : list.some(value => /zh-cn|zh-sg|zh-hans|^zh$/i.test(value))
                        ? 'Hans'
                        : 'unspecified';
        },
        chineseFonts: () => {
            fontResult ??= measureFonts(document);
            s.cjkFonts = fontResult.cjkFonts;
        },
        vendorFonts: () => {
            fontResult ??= measureFonts(document);
            s.vendorFonts = fontResult.vendorFonts;
        },
        domesticBrowser: () => {
            const source = getUa();
            s.browserToken =
                source === null ? null : matchToken(`${source} ${getBrands() ?? ''}`, browserTokens);
            inAppBrowser =
                source === null ? null : /MicroMessenger|;\s*wv\b|FBAN|FBAV|Instagram|Line\//i.test(source);
        },
        domesticDevice: () => {
            const source = getUa();
            s.deviceToken =
                source === null ? null : matchToken(`${source} ${getPlatform() ?? ''}`, deviceTokens);
        },
        intlLocale: () => {
            s.locale = read(() => new Intl.DateTimeFormat().resolvedOptions().locale || null);
        },
        timezoneOffset: () => {
            s.offset = read(() => {
                const offset = -new Date().getTimezoneOffset();
                if (!Number.isFinite(offset)) throw new Error('Unavailable offset');
                return offset;
            });
        },
        emojiStyle: () => {
            const source = getUa();
            s.emoji =
                source === null
                    ? null
                    : /iphone|ipad|mac os|macintosh/i.test(source)
                      ? 'Apple'
                      : /android|harmonyos/i.test(source)
                        ? 'Android'
                        : /windows/i.test(source)
                          ? 'Windows'
                          : 'unspecified';
        },
        browser: () => {
            const source = getUa();
            s.browser =
                source === null
                    ? null
                    : /Edg\//i.test(source)
                      ? 'Microsoft Edge'
                      : /OPR\//.test(source)
                        ? 'Opera'
                        : /YaBrowser/i.test(source)
                          ? 'Yandex Browser'
                          : /MicroMessenger/i.test(source)
                            ? 'WeChat'
                            : /Firefox\//.test(source)
                              ? 'Firefox'
                              : /Chrome\//.test(source)
                                ? 'Chrome'
                                : /Safari\//.test(source)
                                  ? 'Safari'
                                  : 'unspecified';
        },
        device: () => {
            const source = getUa();
            const hint = getPlatform();
            s.platform =
                source === null
                    ? null
                    : /harmonyos/i.test(`${source} ${hint}`)
                      ? 'HarmonyOS'
                      : /android/i.test(source)
                        ? 'Android'
                        : /iphone|ipad|ios/i.test(source)
                          ? 'iOS'
                          : /mac os|macintosh|macintel/i.test(`${source} ${hint}`)
                            ? 'macOS'
                            : /windows nt|win32|win64/i.test(`${source} ${hint}`)
                              ? 'Windows'
                              : /linux/i.test(source)
                                ? 'Linux'
                                : hint || 'unspecified';
        },
    };
    let completed = 0;
    for (const check of checks) {
        if (options.only && options.only !== check.id) continue;
        signal?.throwIfAborted();
        readers[check.id]();
        onProgress?.(++completed, check.id);
    }
    return scoreBrowserSignals(s, inAppBrowser);
}
export function offsetAt(timezone: string | null, checkedAt: string): number | null {
    if (!timezone) return null;
    try {
        const date = new Date(checkedAt);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(date);
        const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
        const local = Date.UTC(
            value('year'),
            value('month') - 1,
            value('day'),
            value('hour'),
            value('minute'),
            value('second'),
        );
        const offset = Math.round((local - date.getTime()) / 60000);
        return Number.isFinite(offset) && Math.abs(offset) <= 840 ? offset : null;
    } catch {
        return null;
    }
}
export function reportView(report: BrowserReport) {
    const s = report.signals;
    const none: Copy = ['未检出', 'No match'];
    const unknown: Copy = ['无法读取', 'Unavailable'];
    const value = (v: string | string[] | number | null): Copy =>
        v === null
            ? unknown
            : Array.isArray(v)
              ? v.length
                  ? [v.join('、'), v.join(', ')]
                  : none
              : v === ''
                ? none
                : v === 'unspecified'
                  ? ['未确定', 'Undetermined']
                  : [String(v), String(v)];
    const offset =
        s.offset === null
            ? unknown
            : ([
                  'UTC' +
                      String(s.offset < 0 ? '−' : '+') +
                      String(Math.floor(Math.abs(s.offset) / 60)) +
                      String(
                          Math.abs(s.offset) % 60
                              ? ':' + String(String(Math.abs(s.offset) % 60).padStart(2, '0'))
                              : '',
                      ),
                  '',
              ] as unknown as Copy);
    const values: Copy[] = [
        value(s.timezone),
        s.languages === null
            ? unknown
            : [
                  `首选：${s.languages[0] ?? '未知'} · 完整列表：${s.languages.join('、')}`,
                  `Preferred: ${s.languages[0] ?? 'Unknown'} · Full list: ${s.languages.join(', ')}`,
              ],
        s.script === 'Hans'
            ? ['简体中文', 'Simplified Chinese']
            : s.script === 'Hant'
              ? ['繁体中文', 'Traditional Chinese']
              : value(s.script),
        value(s.cjkFonts),
        value(s.vendorFonts),
        value(s.browserToken),
        value(s.deviceToken),
        value(s.locale),
        [offset[0], offset[0]],
        s.emoji === 'Apple' ? ['苹果系统表情风格（推测）', 'Apple emoji style (estimated)'] : value(s.emoji),
        s.browser === 'WeChat' ? ['微信内置浏览器', 'WeChat in-app browser'] : value(s.browser),
        value(s.platform),
    ];
    return {
        ...report,
        values,
        facts: {
            timezone: s.timezone,
            utcOffset: s.offset,
            platform: s.platform,
            inAppBrowser: report.inAppBrowser,
        },
    };
}
