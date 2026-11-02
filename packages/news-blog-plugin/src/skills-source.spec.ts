import { describe, expect, it } from 'vitest';

import {
    fingerprint,
    nearDuplicate,
    parseSkillBoard,
    parseSkillDocument,
    skillOrder,
    skillPageAllowed,
    skillWindow,
    type SkillEvidence,
} from './skills-source';
const document = [
    '---\nname: document-helper\ndescription: Extract and summarize project documents for users.\n',
    '---\n# Document helper\n',
    `${'Reads only supplied documents and preserves their sources. '.repeat(8)}`,
].join('');
const evidence = (rankings: SkillEvidence['rankings'], stars = 1000): SkillEvidence => ({
    repository: 'owner/repo',
    repositoryId: '123',
    directory: 'skills/document-helper',
    name: 'document-helper',
    description: 'Read documents',
    body: document,
    readme: '',
    commit: 'a'.repeat(40),
    stars,
    rankings,
    observedAt: new Date().toISOString(),
    aliases: [],
});
describe('skill discovery and selection evidence', () => {
    it('reads real leaderboard rows but excludes non-GitHub sources and out-of-range ranks', () => {
        const row = (href: string, rank: number) =>
            `<a href="${href}"><div><span>${rank}</span></div><div><h3>document-helper</h3></div><div><span>1.5K</span></div></a>`;
        const rows = parseSkillBoard(
            row('/owner/repo/document-helper', 12) +
                row('/site/example.com/document-helper', 1) +
                row('/owner/other/document-helper', 51),
            'trending',
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            repository: 'owner/repo',
            rankings: [{ view: 'trending', rank: 12, displayCount: '1.5K' }],
        });
        expect(parseSkillBoard('<html>temporarily unavailable</html>', 'hot')).toEqual([]);
    });
    it('requires actual Skill front matter and a meaningful body, including multiline descriptions', () => {
        expect(parseSkillDocument(document)?.name).toBe('document-helper');
        expect(
            parseSkillDocument(
                document.replace(
                    'description: Extract and summarize project documents for users.',
                    'description: >\n  Extract project documents.\n  Preserve the source links.',
                ),
            )?.description,
        ).toContain('Preserve');
        expect(
            parseSkillDocument(document.replace('name: document-helper', 'name: Invalid Name')),
        ).toBeNull();
        expect(parseSkillDocument('name: document-helper\n' + 'text'.repeat(80))).toBeNull();
    });
    it('prioritizes recent popularity and falls back to evergreen with deterministic ties', () => {
        const all = evidence(
            [{ view: 'all-time', rank: 1, url: 'https://www.skills.sh/', displayCount: '2M' }],
            100000,
        );
        const recent = evidence([
            { view: 'trending', rank: 40, url: 'https://www.skills.sh/trending', displayCount: '2K' },
        ]);
        expect(skillOrder(recent, all)).toBeLessThan(0);
        expect(
            skillOrder(evidence([{ view: 'hot', rank: 1, url: '', displayCount: '' }]), recent),
        ).toBeGreaterThan(0);
    });
    it('detects copies and highly similar text without conflating unrelated skills', () => {
        expect(fingerprint(document)).toBe(fingerprint(document.replace(/\n/g, '\r\n')));
        const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
        expect(nearDuplicate(text, text + ' additional tail')).toBe(true);
        expect(nearDuplicate(text, 'unrelated different vocabulary '.repeat(100))).toBe(false);
    });
    it('honours public-page robots restrictions without scraping private API paths', () => {
        const rules = 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /trending';
        expect(skillPageAllowed(rules, '/hot')).toBe(true);
        expect(skillPageAllowed(rules, '/trending')).toBe(false);
        expect(skillPageAllowed(rules, '/api/v1/skills')).toBe(false);
    });
    it('uses the merchant publication date in Malaysia across the UTC boundary', () => {
        expect(skillWindow(new Date('2026-11-02T16:01:00Z'))).toEqual({ day: '2026-11-03', time: '00:01' });
    });
});
