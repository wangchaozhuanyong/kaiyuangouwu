import { afterEach, describe, expect, it, vi } from 'vitest';

import { checks } from './content';
import {
    type BrowserSignals,
    collectBrowserReport,
    measureFonts,
    offsetAt,
    reportView,
    scoreBrowserSignals,
} from './detection';
export const sampleSignals: BrowserSignals = {
    timezone: 'Asia/Kuala_Lumpur',
    offset: 480,
    languages: ['zh-CN', 'en-US'],
    script: 'Hans',
    locale: 'zh-CN',
    cjkFonts: ['PingFang SC', 'Hiragino Sans GB', 'STHeiti', 'STSong'],
    vendorFonts: [],
    browserToken: '',
    deviceToken: '',
    emoji: 'Apple',
    browser: 'Chrome',
    platform: 'macOS',
};
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});
describe('live reference scoring', () => {
    it('uses twelve independent contributions, including the actual four-point UTC weight', () => {
        const report = scoreBrowserSignals(sampleSignals);
        expect(report.contributions).toEqual([9, 20, 12, 16, 0, 0, 0, 6, 3, 1, 0, 0]);
        expect(report.score).toBe(67);
        expect(checks.reduce((sum, check) => sum + check.weight, 0)).toBe(112);
        expect(report.coverage).toBe(12);
    });
    it('matches mainland, other Chinese and Asian timezone ratios without claiming a fault', () => {
        for (const [timezone, contribution] of [
            ['Asia/Shanghai', 26],
            ['Asia/Hong_Kong', 16],
            ['Asia/Kuala_Lumpur', 9],
            ['America/New_York', 0],
        ] as const)
            expect(scoreBrowserSignals({ ...sampleSignals, timezone }).contributions[0]).toBe(contribution);
        expect(scoreBrowserSignals({ ...sampleSignals, offset: 420 }).contributions[8]).toBe(2);
        expect(scoreBrowserSignals({ ...sampleSignals, offset: 540 }).contributions[8]).toBe(2);
    });
    it('handles secondary languages, traditional fonts, single vendor and device markers', () => {
        const r = scoreBrowserSignals({
            ...sampleSignals,
            languages: ['en-US', 'zh-HK'],
            script: 'Hant',
            cjkFonts: ['MingLiU'],
            vendorFonts: ['MiSans'],
            deviceToken: 'huawei',
            locale: 'zh-HK',
        });
        expect(r.contributions.slice(1, 8)).toEqual([10, 12, 8, 8, 0, 4, 3]);
        expect(
            scoreBrowserSignals({ ...sampleSignals, vendorFonts: ['HarmonyOS Sans', 'HarmonyOS Sans SC'] })
                .contributions[4],
        ).toBe(8);
        expect(
            scoreBrowserSignals({ ...sampleSignals, vendorFonts: ['MiSans', 'HarmonyOS Sans'] })
                .contributions[4],
        ).toBe(10);
    });
    it('rounds each font contribution and caps the raw total instead of normalizing weights', () => {
        expect(scoreBrowserSignals({ ...sampleSignals, cjkFonts: ['SimSun'] }).contributions[3]).toBe(13);
        expect(
            scoreBrowserSignals({ ...sampleSignals, cjkFonts: ['SimSun', 'SimHei'] }).contributions[3],
        ).toBe(15);
        expect(
            scoreBrowserSignals({
                ...sampleSignals,
                timezone: 'Asia/Shanghai',
                vendorFonts: ['MiSans', 'Honor Sans'],
                browserToken: 'micromessenger',
                deviceToken: 'harmonyos',
                emoji: 'Android',
            }).score,
        ).toBe(100);
    });
    it('keeps all ten failed scoring inputs unknown while information-only failures retain the total', () => {
        for (const field of [
            'timezone',
            'offset',
            'languages',
            'script',
            'locale',
            'cjkFonts',
            'vendorFonts',
            'browserToken',
            'deviceToken',
            'emoji',
        ] as const)
            expect(scoreBrowserSignals({ ...sampleSignals, [field]: null }).score).toBeNull();
        expect(scoreBrowserSignals({ ...sampleSignals, browser: null, platform: null }).score).toBe(67);
        const zero = scoreBrowserSignals({
            ...sampleSignals,
            timezone: 'Etc/UTC',
            offset: 0,
            languages: ['en-US'],
            script: 'unspecified',
            locale: 'en-US',
            cjkFonts: [],
            emoji: 'unspecified',
        });
        expect(zero.score).toBe(0);
    });
    it('computes network offsets at the provider timestamp, including half-hour zones and DST', () => {
        expect(offsetAt('Asia/Kuala_Lumpur', '2026-11-02T00:00:00Z')).toBe(480);
        expect(offsetAt('Asia/Kolkata', '2026-11-02T00:00:00Z')).toBe(330);
        expect(offsetAt('America/New_York', '2026-07-02T00:00:00Z')).toBe(-240);
        expect(offsetAt('invalid', '2026-11-02T00:00:00Z')).toBeNull();
        expect(offsetAt(null, 'invalid')).toBeNull();
    });
    it('does not fabricate font absence when canvas or measurements fail', () => {
        expect(
            measureFonts({ createElement: () => ({ getContext: () => null }) } as unknown as Document),
        ).toEqual({ cjkFonts: null, vendorFonts: null });
    });
    it('reads UA-CH and actual task completion, without uploading or storing raw UA strings', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        vi.stubGlobal('navigator', {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0',
            languages: ['zh-CN'],
            language: 'zh-CN',
            platform: 'Win32',
            userAgentData: { brands: [{ brand: 'QQBrowser', version: '1' }], platform: 'Windows' },
        });
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
        const progress = vi.fn();
        const r = await collectBrowserReport({ onProgress: progress });
        expect(progress.mock.calls.map(call => call[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(r.signals.browserToken).toBe('qqbrowser');
        expect(r.signals.cjkFonts).toBeNull();
        expect(r.score).toBeNull();
        expect(JSON.stringify(r)).not.toContain('Mozilla/5.0');
        expect(reportView(r).values).toHaveLength(12);
    });
    it('supports an isolated retry and cancels before reading when aborted', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        const previous = scoreBrowserSignals(sampleSignals);
        const r = await collectBrowserReport({ only: 'timezoneOffset', previous });
        expect(r.signals.cjkFonts).toEqual(previous.signals.cjkFonts);
        expect(r.signals.languages).toEqual(previous.signals.languages);
        const c = new AbortController();
        c.abort();
        await expect(collectBrowserReport({ signal: c.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
    });
});
