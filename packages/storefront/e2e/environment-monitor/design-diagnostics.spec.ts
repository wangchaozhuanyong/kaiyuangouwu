import { describe, expect, it } from 'vitest';

import { compareFinding, diagnose, recheckSample, sampleNetwork, scanFeedback } from './design-diagnostics';
import { checks, sampleFor, scoreContributions } from './design-model';

describe('rule-based preview diagnosis', () => {
    it('does not mistake Chinese preferences or shared Asian offsets for faults', () => {
        const report = sampleFor('typical');
        expect(report.score).toBe(67);
        const findings = diagnose(report, 'ready', sampleNetwork('typical'));
        expect(findings.length).toBeGreaterThan(0);
        expect(findings.every(item => item.kind === 'optimization')).toBe(true);
        expect(findings.find(item => item.id === 'regional-timezone')?.steps).toHaveLength(2);
        const high = sampleFor('high');
        expect(diagnose(high, 'ready', sampleNetwork('high')).map(item => item.id)).not.toContain(
            'time-difference',
        );
    });
    it('does not infer a proxy or a problem solely from data center classification', () => {
        const network = sampleNetwork('datacenter');
        expect(network.type).toBe('datacenter');
        expect(network.proxy).toBe(false);
        expect(
            diagnose(sampleFor('datacenter'), 'ready', network).filter(item => item.kind !== 'optimization'),
        ).toEqual([]);
    });
    it('offers conditional advice for moderate reputation and stronger priority for high values', () => {
        const report = sampleFor('typical');
        for (const [score, tone] of [
            [39, null],
            [40, 'check'],
            [69, 'check'],
            [70, 'review'],
        ] as const) {
            const finding = diagnose(report, 'ready', { ...sampleNetwork('typical'), score }).find(
                item => item.id === 'network-reputation',
            );
            expect(finding?.tone ?? null).toBe(tone);
        }
    });
    it('merges network reputation and proxy evidence and prioritizes it ahead of compatibility', () => {
        const findings = diagnose(sampleFor('high'), 'ready', sampleNetwork('high'));
        expect(findings.filter(item => item.kind !== 'optimization').map(item => item.id)).toEqual([
            'network-reputation',
            'in-app-browser',
        ]);
        expect(findings.some(item => item.kind === 'optimization')).toBe(true);
        expect(findings[0].scope).toBe('network');
        expect(findings[1].steps[0][0]).toContain('正常');
    });
    it('compares current offsets rather than different timezone identifiers', () => {
        const report = sampleFor('mismatch');
        const network = sampleNetwork('mismatch');
        const finding = requiredValue(
            diagnose(report, 'ready', network).find(item => item.id === 'time-difference'),
        );
        expect(finding.related).toEqual(['timezone', 'timezoneOffset']);
        expect(finding.steps[1][0]).toContain('Windows');
        expect(diagnose(report, 'error', network).some(item => item.id === 'time-difference')).toBe(false);
    });
    it('keeps unreadable scored inputs unknown and supplies a targeted recovery', () => {
        const report = sampleFor('unavailable');
        const finding = diagnose(report, 'ready', sampleNetwork('typical'))[0];
        expect(report.score).toBeNull();
        expect(finding.id).toBe('unavailable-chineseFonts');
        expect(finding.related).toEqual(['chineseFonts']);
        expect(compareFinding(finding, report, 'ready', sampleNetwork('typical'))).toBe('unknown');
    });
    it('distinguishes quota exhaustion from timeouts without labeling either safe', () => {
        const quota = diagnose(sampleFor('quota'), 'error', null, 'quota')[0];
        const timeout = diagnose(sampleFor('partial'), 'error', null)[0];
        expect(quota.title[0]).toBe('今日检测次数额度已用完');
        expect(quota.steps[0][0]).toContain('浏览器本地检测仍可使用');
        expect(quota.steps[1][0]).toContain('无需修改电脑设置或付费解锁');
        expect(timeout.evidence[0]).toContain('超时');
    });
    it('shows cleared evidence even when a timezone correction increases the regional score', () => {
        const report = sampleFor('mismatch');
        const network = sampleNetwork('mismatch');
        const finding = diagnose(report, 'ready', network)[0];
        const result = recheckSample(finding, report, network, 'resolved');
        expect(compareFinding(finding, result.report, 'ready', result.network)).toBe('cleared');
        expect(requiredValue(result.report.score)).toBeGreaterThan(requiredValue(report.score));
        expect(report.facts.timezone).toBe('America/New_York');
        expect(result.report.facts.timezone).toBe('Asia/Kuala_Lumpur');
    });
    it('supports persistent and unconfirmed results without changing unrelated readings', () => {
        const report = sampleFor('high');
        const network = sampleNetwork('high');
        const finding = diagnose(report, 'ready', network)[1];
        const unchanged = recheckSample(finding, report, network, 'unchanged');
        expect(compareFinding(finding, unchanged.report, 'ready', network)).toBe('persists');
        const resolved = recheckSample(finding, report, network, 'resolved');
        expect(compareFinding(finding, resolved.report, 'ready', network)).toBe('cleared');
        expect(resolved.report.ratios[3]).toBe(report.ratios[3]);
        expect(resolved.report.facts.inAppBrowser).toBe(false);
        expect(compareFinding(finding, null, 'ready', network)).toBe('unknown');
    });
    it('has bilingual evidence, steps, explanations and verification for every rule', () => {
        const findings = [
            ...diagnose(sampleFor('high'), 'ready', sampleNetwork('high')),
            ...diagnose(sampleFor('mismatch'), 'ready', sampleNetwork('mismatch')),
            ...diagnose(sampleFor('unavailable'), 'error', null),
            ...diagnose(sampleFor('quota'), 'error', null, 'quota'),
        ];
        for (const finding of findings) {
            for (const pair of [
                finding.title,
                finding.evidence,
                finding.explanation,
                finding.verify,
                ...finding.steps,
            ]) {
                expect(pair[0]).toMatch(/\p{Script=Han}/u);
                expect(pair[1]).not.toMatch(/\p{Script=Han}/u);
                expect(pair[1]).toMatch(/[A-Za-z]/);
            }
        }
    });
    it('gives targeted recovery and verification for every unreadable item without blocking scores for information-only items', () => {
        for (const [index, check] of checks.entries()) {
            const base = sampleFor('typical');
            const ratios = [...base.ratios];
            ratios[index] = null;
            const report = { ...base, ratios, ...scoreContributions(ratios) };
            const finding = requiredValue(
                diagnose(report, 'ready', sampleNetwork('typical')).find(
                    item => item.id === `unavailable-${check.id}`,
                ),
            );
            expect(finding.related).toEqual([check.id]);
            expect(finding.steps.length).toBeGreaterThan(0);
            expect(finding.verify[0]).toContain('复查');
            if (check.weight) expect(report.score).toBeNull();
            else {
                expect(report.score).toBe(67);
                expect(finding.explanation[0]).toContain('不影响');
            }
        }
    });
    it('does not treat missing network data as residential or low risk and retains other findings', () => {
        const report = sampleFor('typical');
        expect(
            diagnose(report, 'ready', null)
                .filter(item => item.kind !== 'optimization')
                .map(item => item.id),
        ).toEqual(['network-incomplete']);
        const network = sampleNetwork('network-unknown');
        expect(network.score).toBeNull();
        expect(network.type).toBe('unknown');
        expect(
            diagnose(report, 'ready', network)
                .filter(item => item.kind !== 'optimization')
                .map(item => item.id),
        ).toEqual(['network-incomplete']);
        const mixed = { ...sampleNetwork('high'), timezone: null };
        expect(
            diagnose(sampleFor('high'), 'ready', mixed)
                .filter(item => item.kind !== 'optimization')
                .map(item => item.id),
        ).toEqual(['network-reputation', 'network-incomplete', 'in-app-browser']);
    });
    it('closes the scan cycle with persistent, cleared and unconfirmed feedback based on readings', () => {
        const high = diagnose(sampleFor('high'), 'ready', sampleNetwork('high'));
        expect(scanFeedback(high, high)[0]).toContain(`仍有 ${high.length} 项建议`);
        expect(scanFeedback(high, [])[0]).toContain('未再检出');
        expect(scanFeedback(high, diagnose(sampleFor('partial'), 'error', null))[0]).toContain('无法确认');
        expect(scanFeedback(null, [])[0]).toContain('可读取');
    });
    it('never clears an earlier network or timezone warning when the new network reading is missing', () => {
        const report = sampleFor('high');
        const reputation = diagnose(report, 'ready', sampleNetwork('high'))[0];
        expect(compareFinding(reputation, report, 'ready', null)).toBe('unknown');
        expect(compareFinding(reputation, report, 'ready', sampleNetwork('network-unknown'))).toBe('unknown');
        const timeFinding = diagnose(sampleFor('mismatch'), 'ready', sampleNetwork('mismatch'))[0];
        expect(
            compareFinding(timeFinding, sampleFor('mismatch'), 'ready', sampleNetwork('network-unknown')),
        ).toBe('unknown');
    });
});

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
