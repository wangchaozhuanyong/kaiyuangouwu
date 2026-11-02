import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';

import { hash } from './content';
import { BlogSkill, BlogSkillObservation, BlogSkillRecommendation, BlogSkillState } from './skill-entities';
import { BlogSkillsHttp } from './skills-http';
import {
    fingerprint,
    nearDuplicate,
    parseSkillBoard,
    parseSkillDocument,
    SkillDiscovery,
    SkillEvidence,
    skillPageAllowed,
} from './skills-source';
type Repo = {
    id: number;
    full_name: string;
    archived: boolean;
    disabled: boolean;
    fork: boolean;
    stargazers_count: number;
    default_branch: string;
};
type TreeEntry = { path: string; type: string; sha: string; size?: number; mode: string };
@Injectable()
export class BlogSkillsCatalog {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly http: BlogSkillsHttp,
    ) {}
    private async repository(repository: string, purpose: 'discovery' | 'publication' = 'publication') {
        if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) throw new Error('Skill 仓库无效');
        const repo = await this.http.json<Repo>(`/repos/${repository}`, purpose);
        if (
            !Number.isSafeInteger(repo.id) ||
            !/^[\w.-]+\/[\w.-]+$/u.test(repo.full_name) ||
            repo.archived ||
            repo.disabled ||
            repo.fork ||
            !Number.isSafeInteger(repo.stargazers_count) ||
            repo.stargazers_count < 1000
        )
            throw new Error('仓库未达到原始公开热门仓库要求');
        return repo;
    }
    async verify(evidence: SkillEvidence): Promise<SkillEvidence> {
        const repo = await this.repository(evidence.repository);
        if (String(repo.id) !== evidence.repositoryId) throw new Error('仓库身份已变化');
        // The immutable source remains the generation evidence, even if the default branch moves.
        const file = await this.http.json<{ content?: string; encoding?: string }>(
            `/repos/${repo.full_name}/contents/${evidence.directory ? `${evidence.directory}/` : ''}SKILL.md?ref=${evidence.commit}`,
        );
        const body =
            file.encoding === 'base64' ? Buffer.from(file.content ?? '', 'base64').toString('utf8') : '';
        if (fingerprint(body) !== fingerprint(evidence.body) || !parseSkillDocument(body))
            throw new Error('Skill 原文核验失败');
        return { ...evidence, repository: repo.full_name, stars: repo.stargazers_count };
    }
    async refresh(now = new Date()) {
        const state = await this.http.state();
        const states = this.connection.rawConnection.getRepository(BlogSkillState);
        if (state.lastCollectedAt && now.getTime() - state.lastCollectedAt.getTime() < 6 * 3600000) return;
        const leaseUntil = new Date(now.getTime() + 20 * 60000);
        const claim = await states
            .createQueryBuilder()
            .update()
            .set({ leaseUntil })
            .where('id = :id', { id: state.id })
            .andWhere('(leaseUntil IS NULL OR leaseUntil < :now)', { now })
            .execute();
        if (claim.affected !== 1) return;
        const candidates = this.connection.rawConnection.getRepository(BlogSkill);
        let found = 0;
        let updated = 0;
        let failed = 0;
        try {
            const robots = await this.http.read('https://www.skills.sh/robots.txt');
            const discoveries = new Map<string, SkillDiscovery>();
            for (const view of ['trending', 'hot', 'all-time'] as const) {
                try {
                    if (!skillPageAllowed(robots, view === 'all-time' ? '/' : `/${view}`))
                        throw new Error('榜单停止允许采集');
                    const rows = parseSkillBoard(
                        await this.http.read(
                            `https://www.skills.sh${view === 'all-time' ? '/' : `/${view}`}`,
                        ),
                        view,
                    );
                    if (!rows.length) throw new Error('榜单格式变化');
                    for (const row of rows) {
                        const key = `${row.repository.toLowerCase()}/${row.slug}`;
                        const prior = discoveries.get(key);
                        discoveries.set(key, {
                            ...row,
                            rankings: [...(prior?.rankings ?? []), ...row.rankings],
                        });
                    }
                } catch {
                    failed++;
                }
            }
            found = discoveries.size;
            const groups = new Map<string, SkillDiscovery[]>();
            for (const row of discoveries.values())
                groups.set(row.repository, [...(groups.get(row.repository) ?? []), row]);
            // Rotate discovery while favouring never-resolved repositories so large packs cannot starve the pool.
            const existing = await candidates.find();
            const knownRepos = new Set(existing.map(x => x.repository.toLowerCase()));
            const published = new Set(
                (
                    await this.connection.rawConnection
                        .getRepository(BlogSkillRecommendation)
                        .find({ where: { status: 'PUBLISHED' } })
                ).map(x => x.repositoryId),
            );
            const priority = (repo: string) =>
                existing.some(
                    x =>
                        x.repository.toLowerCase() === repo.toLowerCase() &&
                        published.has(x.repositoryId) &&
                        now.getTime() - x.checkedAt.getTime() >= 86400000,
                )
                    ? 0
                    : !knownRepos.has(repo.toLowerCase())
                      ? 1
                      : 2;
            const ordered = [...groups.entries()].sort(([a], [b]) => priority(a) - priority(b));
            const urgent = ordered.filter(([repo]) => priority(repo) === 0);
            const recent = ordered.filter(
                ([repo, rows]) =>
                    priority(repo) !== 0 && rows.some(x => x.rankings.some(y => y.view !== 'all-time')),
            );
            const evergreen = ordered.filter(
                ([repo, rows]) =>
                    priority(repo) !== 0 && rows.every(x => x.rankings.every(y => y.view === 'all-time')),
            );
            const groupRows = [...urgent];
            // Reserve discovery capacity for evergreen options when today's popular pack has already appeared.
            while (recent.length || evergreen.length) {
                for (const pool of [recent, recent, evergreen]) {
                    const row = pool.shift();
                    if (row) groupRows.push(row);
                }
            }
            for (const [repository, skills] of groupRows) {
                const currentState = await this.http.state();
                if (currentState.requestCount >= 32) break; // Leave room to verify today's publication.
                try {
                    const repo = await this.repository(repository, 'discovery');
                    const commit = await this.http.json<{ sha: string; commit: { tree: { sha: string } } }>(
                        `/repos/${repo.full_name}/commits/${encodeURIComponent(repo.default_branch)}`,
                        'discovery',
                    );
                    if (!/^[a-f0-9]{40}$/u.test(commit.sha)) throw new Error('Skill 来源版本无效');
                    const tree = await this.http.json<{ truncated: boolean; tree: TreeEntry[] }>(
                        `/repos/${repo.full_name}/git/trees/${commit.commit.tree.sha}?recursive=1`,
                        'discovery',
                    );
                    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('仓库目录资料不完整');
                    let readme = '';
                    const readmeFile = tree.tree.find(
                        x =>
                            /^README(?:\.md)?$/iu.test(x.path) && x.type === 'blob' && (x.size ?? 0) <= 55000,
                    );
                    if (readmeFile) {
                        try {
                            readme = await this.blob(repo.full_name, readmeFile.sha);
                        } catch {
                            /* SKILL.md is mandatory, README optional. */
                        }
                    }
                    for (const discovery of skills.slice(0, 8)) {
                        const paths = tree.tree.filter(
                            x =>
                                x.type === 'blob' &&
                                x.mode !== '120000' &&
                                /(?:^|\/)SKILL\.md$/u.test(x.path) &&
                                (x.size ?? 0) <= 55000 &&
                                (x.path === 'SKILL.md' || x.path.split('/').at(-2) === discovery.slug),
                        );
                        if (paths.length !== 1) continue;
                        const file = paths[0];
                        const body = await this.blob(repo.full_name, file.sha);
                        const parsed = parseSkillDocument(body);
                        if (!parsed || parsed.name !== discovery.slug) continue;
                        const directory = file.path.replace(/(?:^|\/)SKILL\.md$/u, '');
                        const identity = hash(`${repo.id}:${directory}`);
                        const contentHash = fingerprint(body);
                        const exact = existing.find(x => x.identity === identity);
                        const copied = existing.find(
                            x => x.identity !== identity && x.contentHash === contentHash,
                        );
                        if (copied) continue;
                        const alias = existing.find(
                            x =>
                                x.repositoryId === String(repo.id) &&
                                x.name === parsed.name &&
                                x.contentHash === contentHash,
                        );
                        const row = exact ?? alias;
                        const evidence: SkillEvidence = {
                            repository: repo.full_name,
                            repositoryId: String(repo.id),
                            directory,
                            ...parsed,
                            body,
                            readme,
                            commit: commit.sha,
                            stars: repo.stargazers_count,
                            rankings: discovery.rankings,
                            observedAt: now.toISOString(),
                            aliases: [
                                ...new Set([
                                    ...(row ? (JSON.parse(row.evidenceJson) as SkillEvidence).aliases : []),
                                    identity,
                                ]),
                            ],
                        };
                        const similar = existing.find(x => x.id !== row?.id && nearDuplicate(x.body, body));
                        const saved = await candidates.save(
                            new BlogSkill({
                                ...row,
                                identity: row?.identity ?? identity,
                                repositoryId: String(repo.id),
                                repository: repo.full_name,
                                directory,
                                name: parsed.name,
                                contentHash,
                                body,
                                evidenceJson: JSON.stringify(evidence),
                                checkedAt: now,
                                status: similar ? 'REVIEW' : 'READY',
                                message: similar ? '与已有技能高度相似，暂停自动推荐' : '',
                            }),
                        );
                        if (!row) existing.push(saved);
                        await this.connection.rawConnection.getRepository(BlogSkillObservation).save(
                            new BlogSkillObservation({
                                identity: saved.identity,
                                stars: repo.stargazers_count,
                                rankingJson: JSON.stringify(discovery.rankings),
                                observedAt: now,
                            }),
                        );
                        updated++;
                    }
                } catch {
                    failed++;
                }
            }
        } catch {
            failed++;
        } finally {
            await states.update(
                { id: state.id, leaseUntil },
                {
                    leaseUntil: null,
                    lastCollectedAt: now,
                    message: `发现 ${found} 条，核验 ${updated} 条，来源或仓库未完成 ${failed} 项；未通过的条目不会自动发布`,
                },
            );
        }
    }
    private async blob(repository: string, sha: string) {
        const file = await this.http.json<{ content?: string; encoding?: string }>(
            `/repos/${repository}/git/blobs/${sha}`,
            'discovery',
        );
        if (file.encoding !== 'base64') throw new Error('Skill 原文格式无效');
        const body = Buffer.from(file.content ?? '', 'base64').toString('utf8');
        if (body.length > 55000) throw new Error('Skill 原文过长');
        return body;
    }
}
