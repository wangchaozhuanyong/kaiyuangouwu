import { load } from 'cheerio';
import { createHash } from 'node:crypto';
export type SkillRanking = {
    view: 'trending' | 'hot' | 'all-time';
    rank: number;
    url: string;
    displayCount: string;
};
export type SkillDiscovery = { repository: string; slug: string; rankings: SkillRanking[] };
export type SkillEvidence = {
    sourceSnapshotAt?: string;
    history?: { day: string; parentRunId: string };
    repository: string;
    repositoryId: string;
    directory: string;
    name: string;
    description: string;
    body: string;
    readme: string;
    commit: string;
    stars: number;
    rankings: SkillRanking[];
    observedAt: string;
    aliases: string[];
};
export const fingerprint = (body: string) =>
    createHash('sha256').update(body.replace(/\r/gu, '').replace(/\s+/gu, ' ').trim()).digest('hex');
export function parseSkillBoard(html: string, view: SkillRanking['view']): SkillDiscovery[] {
    const $ = load(html);
    const rows: SkillDiscovery[] = [];
    const limit = view === 'trending' ? 50 : view === 'hot' ? 30 : 300;
    $('a[href]').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') ?? '';
        const match = /^\/([\w.-]+)\/([\w.-]+)\/([a-z0-9-]+)$/u.exec(href);
        if (!match || match[1] === 'site' || !a.find('h3').length) return;
        const rank = Number(a.children('div').first().text().trim());
        if (!Number.isInteger(rank) || rank < 1 || rank > limit) return;
        rows.push({
            repository: `${match[1]}/${match[2]}`,
            slug: match[3],
            rankings: [
                {
                    view,
                    rank,
                    url: `https://www.skills.sh${view === 'all-time' ? '/' : `/${view}`}`,
                    displayCount: a.children('div').last().text().trim().slice(0, 50),
                },
            ],
        });
    });
    return rows;
}
export function parseSkillDocument(body: string): { name: string; description: string } | null {
    const front = /^---\s*\n([\s\S]*?)\n---(?:\s|$)/u.exec(body.replace(/\r/gu, ''))?.[1];
    if (!front || body.length < 200 || body.length > 55000) return null;
    const name = /^name:\s*['"]?([a-z0-9]+(?:-[a-z0-9]+)*)['"]?\s*$/mu.exec(front)?.[1];
    let description = /^description:\s*(.+)$/mu.exec(front)?.[1]?.trim() ?? '';
    if (/^[>|][-+]?$/u.test(description)) {
        description =
            front
                .split(/\ndescription:\s*[>|][-+]?\s*\n/u)[1]
                ?.split(/\n\S/u)[0]
                ?.replace(/\n\s+/gu, ' ')
                .trim() ?? '';
        // description can be the first front-matter field.
        if (!description)
            description =
                /^description:\s*[>|][-+]?\s*\n((?:[ \t]+[^\n]*\n?)*)/mu
                    .exec(front)?.[1]
                    ?.replace(/\s+/gu, ' ')
                    .trim() ?? '';
    }
    description = description.replace(/^(['"])([\s\S]*)\1$/u, '$2');
    return name && name.length <= 64 && description.length >= 10 && description.length <= 1024
        ? { name, description }
        : null;
}
export function nearDuplicate(a: string, b: string): boolean {
    const shingles = (s: string) => {
        const words = s
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/u)
            .filter(Boolean);
        const set = new Set<string>();
        for (let i = 0; i + 4 < words.length; i++) set.add(words.slice(i, i + 5).join(' '));
        return set;
    };
    const left = shingles(a);
    const right = shingles(b);
    if (Math.min(left.size, right.size) < 20) return false;
    const intersection = [...left].filter(x => right.has(x)).length;
    return intersection / (left.size + right.size - intersection) >= 0.9;
}
export function skillRank(evidence: SkillEvidence, now = Date.now()): [number, number, number, number] {
    if (now - new Date(evidence.observedAt).getTime() > 86400000) return [9, 9999, 9999, 0];
    const rank = (view: SkillRanking['view']) => evidence.rankings.find(x => x.view === view)?.rank ?? 9999;
    const recent = Math.min(rank('trending'), rank('hot')) < 9999;
    return [recent ? 0 : 1, recent ? rank('trending') : rank('all-time'), rank('hot'), -evidence.stars];
}
export function skillOrder(a: SkillEvidence, b: SkillEvidence) {
    const x = skillRank(a);
    const y = skillRank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return `${a.repository}/${a.directory}`.localeCompare(`${b.repository}/${b.directory}`);
}
export function skillSourceUrl(e: Pick<SkillEvidence, 'repository' | 'commit' | 'directory'>) {
    return `https://github.com/${e.repository}/blob/${e.commit}/${e.directory ? `${e.directory}/` : ''}SKILL.md`;
}
export function skillWindow(now = new Date()) {
    return {
        day: new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10),
        time: new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16),
    };
}

/** Longest matching rule wins for the anonymous public-page collector. */
export function skillPageAllowed(robots: string, pathname: string): boolean {
    let active = false;
    let matchLength = -1;
    let allowed = true;
    for (const raw of robots.split(/\r?\n/u)) {
        const line = raw.split('#')[0].trim();
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const key = line.slice(0, colon).toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (key === 'user-agent') {
            active = value === '*';
            continue;
        }
        if (
            active &&
            (key === 'allow' || key === 'disallow') &&
            value &&
            pathname.startsWith(value) &&
            value.length >= matchLength
        ) {
            if (value.length > matchLength || key === 'allow') allowed = key === 'allow';
            matchLength = value.length;
        }
    }
    return allowed;
}
