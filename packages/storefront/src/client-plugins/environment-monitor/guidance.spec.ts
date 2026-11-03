import { describe, expect, it } from 'vitest';

import { checkFollowUp, checks } from './content';
import { type BrowserSignals, reportView, scoreBrowserSignals } from './detection';
import { diagnose, type NetworkView, scanFeedback } from './guidance';
const signals: BrowserSignals = {
    timezone: 'Asia/Kuala_Lumpur',
    offset: 480,
    languages: ['zh-CN'],
    script: 'Hans',
    locale: 'zh-CN',
    cjkFonts: ['PingFang SC'],
    vendorFonts: [],
    browserToken: '',
    deviceToken: '',
    emoji: 'Apple',
    browser: 'Chrome',
    platform: 'macOS',
};
const report = () => reportView(scoreBrowserSignals(signals, false));
const network: NetworkView = {
    high: false,
    low: false,
    checkedAt: new Date(),
    type: 'residential',
    proxy: false,
    score: 0,
    timezone: 'Asia/Kuala_Lumpur',
    utcOffset: 480,
    source: 'IP-DB',
};
describe('guidance from live readings', () => {
    it('provides optional optimization for scored preferences without mislabeling a data center as a fault', () => {
        const findings = diagnose(report(), 'ready', network);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.every(item => item.kind === 'optimization' && item.tone === 'check')).toBe(true);
        expect(diagnose(report(), 'ready', { ...network, type: 'datacenter' })).toEqual(findings);
        expect(diagnose(report(), 'ready', { ...network, timezone: 'Asia/Shanghai' })).toEqual(findings);
        const timezone = requiredValue(findings.find(item => item.id === 'regional-timezone'));
        expect(timezone.evidence[0]).toContain('+9 分');
        expect(timezone.explanation[0]).toContain('Asia/Kuala_Lumpur');
        expect(timezone.steps).toHaveLength(2);
        expect(timezone.steps[1][0]).toContain('Mac');
    });
    it('covers every positive scored item and omits matches that are cleared or unreadable', () => {
        const base = {
            ...report(),
            ratios: checks.map(item => (item.weight ? 1 : 0)),
            contributions: checks.map(item => item.weight),
        };
        const findings = diagnose(base, 'ready', network);
        for (const [index, check] of checks.entries()) {
            const finding = findings.find(item => item.id === `regional-${check.id}`);
            if (!check.weight) {
                expect(finding).toBeUndefined();
                continue;
            }
            expect(finding?.steps).toHaveLength(2);
            expect(finding?.verify[0].length).toBeGreaterThan(10);
            expect(finding?.verify[1]).not.toMatch(/\p{Script=Han}/u);
            const cleared = { ...base, ratios: [...base.ratios], contributions: [...base.contributions] };
            cleared.ratios[index] = 0;
            cleared.contributions[index] = 0;
            expect(
                diagnose(cleared, 'ready', network).some(item => item.id === requiredValue(finding).id),
            ).toBe(false);
            const unavailable = { ...base, ratios: [...base.ratios] as Array<number | null> };
            unavailable.ratios[index] = null;
            expect(
                diagnose(unavailable, 'ready', network).some(item => item.id === requiredValue(finding).id),
            ).toBe(false);
        }
    });
    it('keeps specific mismatch and compatibility recovery instead of duplicating regional suggestions', () => {
        const input = { ...report(), facts: { ...report().facts, utcOffset: -240, inAppBrowser: true } };
        const findings = diagnose(input, 'ready', network);
        expect(findings.find(item => item.related.includes('timezone'))?.id).toBe('time-difference');
        expect(findings.filter(item => item.related.includes('timezone'))).toHaveLength(1);
        expect(findings.find(item => item.related.includes('domesticBrowser'))?.id).toBe('in-app-browser');
        expect(findings.filter(item => item.related.includes('domesticBrowser'))).toHaveLength(1);
    });
    it('provides recovery and a verification method for every failed input, including informational rows', () => {
        for (const [index, check] of checks.entries()) {
            const base = report();
            base.ratios[index] = null;
            const finding = requiredValue(
                diagnose(base, 'ready', network).find(item => item.id === `unavailable-${check.id}`),
            );
            expect(finding.steps.length).toBeGreaterThan(0);
            expect(finding.verify[0]).toContain('复查');
            if (!check.weight) expect(finding.explanation[0]).toContain('不影响');
            expect(checkFollowUp[check.id][0]).toMatch(/\p{Script=Han}/u);
            expect(checkFollowUp[check.id][1]).not.toMatch(/\p{Script=Han}/u);
        }
    });
    it('keeps missing network fields unknown and distinguishes moderate and high reputation', () => {
        expect(diagnose(report(), 'ready', null)[0].tone).toBe('unknown');
        expect(diagnose(report(), 'ready', { ...network, score: null })[0].id).toBe('network-incomplete');
        expect(diagnose(report(), 'ready', { ...network, score: 40 })[0].tone).toBe('check');
        expect(diagnose(report(), 'ready', { ...network, score: 70 })[0].tone).toBe('review');
        expect(diagnose(report(), 'ready', { ...network, score: 0, proxy: true })[0].id).toBe(
            'network-reputation',
        );
    });
    it('gives a relevant recovery for quota, rate limit and loopback connections', () => {
        const quota = diagnose(report(), 'error', null, 'quota')[0];
        expect(quota.title[0]).toBe('今日检测次数额度已用完');
        expect(quota.steps[0][0]).toContain('浏览器本地检测仍可使用');
        expect(diagnose(report(), 'error', null, 'rate')[0].steps[0][0]).toContain('一分钟');
        expect(diagnose(report(), 'error', null, 'address')[0].steps[0][0]).toContain('内网');
    });
    it('compares actual timezone offsets and provides platform-specific checks', () => {
        const mismatch = {
            ...report(),
            facts: { ...report().facts, timezone: 'America/New_York', utcOffset: -240, platform: 'Windows' },
        };
        const finding = diagnose(mismatch, 'ready', network)[0];
        expect(finding.id).toBe('time-difference');
        expect(finding.steps[1][0]).toContain('Windows');
        expect(
            diagnose(mismatch, 'ready', { ...network, utcOffset: null }).some(
                item => item.id === 'time-difference',
            ),
        ).toBe(false);
    });
    it('does not claim a repeated check has fixed persistent or unknown findings', () => {
        const findings = diagnose(report(), 'ready', { ...network, score: 82 });
        expect(scanFeedback(findings, findings)[0]).toContain('仍有');
        expect(scanFeedback(findings, diagnose(report(), 'error', null))[0]).toContain('无法确认');
        expect(scanFeedback(findings, [])[0]).toContain('未再检出');
    });
});

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
