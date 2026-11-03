import { Injectable } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';

import { hash } from './content';
import { dayStart } from './history';
import { SkillDeferred } from './skill-deferral';
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
import { rankedSkillDocuments, readSkillTree } from './skills-tree';
type Repo = {
    id: number;
    full_name: string;
    archived: boolean;
    disabled: boolean;
    fork: boolean;
    stargazers_count: number;
    default_branch: string;
};
@Injectable()
export class BlogSkillsCatalog {
    private historicalCommits = new Map<string, Promise<{ sha: string; at: string }>>();
    private historicalDocuments = new Map<string, Promise<SkillEvidence>>();
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
    async editorialSource(repository: string, directory: string, commit: string): Promise<SkillEvidence> {
        if (
            !/^[a-f0-9]{40}$/u.test(commit) ||
            !/^[\w./-]*$/u.test(directory) ||
            directory.split('/').some(x => x === '.' || x === '..') ||
            directory.length > 1000 ||
            directory.includes('//') ||
            directory.startsWith('/') ||
            directory.endsWith('/')
        )
            throw new Error('Skill 固定版本或目录无效');
        const repo = await this.repository(repository);
        const body = await this.http.document(
            repo.full_name,
            commit,
            `${directory ? directory + '/' : ''}SKILL.md`,
        );
        const parsed = parseSkillDocument(body);
        if (!parsed) throw new Error('固定版本 Skill 文件资料不足');
        const evidence: SkillEvidence = {
            repository: repo.full_name,
            repositoryId: String(repo.id),
            directory,
            ...parsed,
            body,
            readme: '',
            commit,
            stars: repo.stargazers_count,
            rankings: [],
            observedAt: new Date().toISOString(),
            aliases: [hash(`${repo.id}:${directory}`)],
        };
        if (Buffer.byteLength(JSON.stringify(evidence), 'utf8') > 60000)
            throw new Error('Skill 原文超过可安全保存的资料大小');
        return evidence;
    }
    async verifyFree(evidence: SkillEvidence): Promise<SkillEvidence> {
        const age = Date.now() - Date.parse(evidence.observedAt);
        if (
            !Number.isFinite(age) ||
            age < -300000 ||
            age > 86400000 ||
            !Number.isSafeInteger(evidence.stars) ||
            evidence.stars < 1000 ||
            !/^\d+$/u.test(evidence.repositoryId)
        )
            throw new Error('Skill 仓库观察资料不足或过期');
        // Reuse the current catalog's repository observation; re-read the immutable document without API quota.
        const body = await this.http.document(
            evidence.repository,
            evidence.commit,
            `${evidence.directory ? `${evidence.directory}/` : ''}SKILL.md`,
        );
        const parsed = parseSkillDocument(body);
        if (
            !parsed ||
            parsed.name !== evidence.name ||
            parsed.description !== evidence.description ||
            fingerprint(body) !== fingerprint(evidence.body)
        )
            throw new Error('固定版本 Skill 原文核验失败');
        return evidence;
    }
    async historicalEvidence(evidence: SkillEvidence, beforeDay: string): Promise<SkillEvidence> {
        const cutoff = dayStart(beforeDay).toISOString();
        const repoKey = `${evidence.repositoryId}:${cutoff}`;
        let commit = this.historicalCommits.get(repoKey);
        if (!commit) {
            commit = this.http
                .json<Array<{ sha: string; commit: { committer: { date: string } } }>>(
                    `/repos/${evidence.repository}/commits?until=${encodeURIComponent(cutoff)}&per_page=1`,
                    'publication',
                )
                .then(rows => {
                    const row = rows[0];
                    if (
                        !row ||
                        !/^[a-f0-9]{40}$/u.test(row.sha) ||
                        !Number.isFinite(Date.parse(row.commit.committer.date)) ||
                        Date.parse(row.commit.committer.date) > Date.parse(cutoff)
                    )
                        throw new Error('没有回放开始前的固定仓库版本');
                    return { sha: row.sha, at: row.commit.committer.date };
                });
            this.historicalCommits.set(repoKey, commit);
            commit.catch(() => this.historicalCommits.delete(repoKey));
        }
        const fixed = await commit;
        const key = `${repoKey}:${evidence.directory}`;
        let document = this.historicalDocuments.get(key);
        if (!document) {
            document = this.http
                .document(
                    evidence.repository,
                    fixed.sha,
                    `${evidence.directory ? `${evidence.directory}/` : ''}SKILL.md`,
                )
                .then(body => {
                    const parsed = parseSkillDocument(body);
                    if (!parsed || parsed.name !== evidence.name)
                        throw new Error('回放开始前没有这份 Skill 原文');
                    const rankings = evidence.rankings.filter(x => x.view === 'all-time');
                    if (!rankings.length) throw new Error('历史补录只使用已核对的长期热门候选');
                    return {
                        ...evidence,
                        ...parsed,
                        body,
                        readme: '',
                        commit: fixed.sha,
                        sourceSnapshotAt: fixed.at,
                        rankings,
                    };
                });
            this.historicalDocuments.set(key, document);
            document.catch(() => this.historicalDocuments.delete(key));
        }
        return document;
    }
    async refresh(now = new Date(), force = false): Promise<Date | undefined> {
        const state = await this.http.state();
        const states = this.connection.rawConnection.getRepository(BlogSkillState);
        if (state.requestCount >= 32 && state.requestWindow && state.requestWindow > now)
            return state.requestWindow;
        if (
            !force &&
            !state.message.startsWith('等待来源窗口') &&
            state.lastCollectedAt &&
            now.getTime() - state.lastCollectedAt.getTime() < 6 * 3600000
        )
            return;
        const leaseUntil = new Date(now.getTime() + 20 * 60000);
        const claim = await states
            .createQueryBuilder()
            .update()
            .set({ leaseUntil })
            .where('id = :id', { id: state.id })
            .andWhere('(leaseUntil IS NULL OR leaseUntil < :now)', { now })
            .execute();
        if (claim.affected !== 1) return new Date(now.getTime() + 60000);
        const candidates = this.connection.rawConnection.getRepository(BlogSkill);
        let found = 0;
        let updated = 0;
        let failed = 0;
        let deferredUntil: Date | undefined;
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
            const rank = (rows: SkillDiscovery[], view: 'all-time' | 'trending' | 'hot') =>
                Math.min(
                    9999,
                    ...rows.flatMap(x => x.rankings.filter(y => y.view === view).map(y => y.rank)),
                );
            const groupRows = ordered.sort(
                ([a, left], [b, right]) =>
                    priority(a) - priority(b) ||
                    Number(rank(right, 'all-time') < 9999) - Number(rank(left, 'all-time') < 9999) ||
                    rank(left, 'all-time') - rank(right, 'all-time') ||
                    Math.min(rank(left, 'trending'), rank(left, 'hot')) -
                        Math.min(rank(right, 'trending'), rank(right, 'hot')),
            );
            for (const [repository, skills] of groupRows) {
                if (Date.now() - now.getTime() > 10 * 60000) {
                    deferredUntil = new Date(Date.now() + 60000);
                    break;
                }
                const currentState = await this.http.state();
                if (currentState.requestCount >= 32) {
                    deferredUntil = currentState.requestWindow ?? new Date(now.getTime() + 3600000);
                    break;
                }
                try {
                    const repo = await this.repository(repository, 'discovery');
                    const commit = await this.http.json<{ sha: string; commit: { tree: { sha: string } } }>(
                        `/repos/${repo.full_name}/commits/${encodeURIComponent(repo.default_branch)}`,
                        'discovery',
                    );
                    if (!/^[a-f0-9]{40}$/u.test(commit.sha)) throw new Error('Skill 来源版本无效');
                    const tree = await readSkillTree(this.http, repo.full_name, commit.commit.tree.sha);
                    let readme = '';
                    const readmeFile = tree.find(
                        x =>
                            /^README(?:\.md)?$/iu.test(x.path) && x.type === 'blob' && (x.size ?? 0) <= 55000,
                    );
                    if (readmeFile) {
                        try {
                            readme = await this.http.document(repo.full_name, commit.sha, readmeFile.path);
                        } catch {
                            /* SKILL.md is mandatory, README optional. */
                        }
                    }
                    const selectedSkills = skills.slice(0, 16);
                    const documents = await rankedSkillDocuments(
                        this.http,
                        repo.full_name,
                        commit.sha,
                        tree,
                        selectedSkills,
                    );
                    for (const discovery of selectedSkills) {
                        const matched = documents.get(discovery.slug);
                        if (!matched) continue;
                        const { file, body, parsed } = matched;
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
                } catch (error) {
                    failed++;
                    if (error instanceof SkillDeferred) {
                        deferredUntil = error.retryAfter;
                        break;
                    }
                }
            }
        } catch (error) {
            failed++;
            deferredUntil =
                error instanceof SkillDeferred ? error.retryAfter : new Date(Date.now() + 30 * 60000);
        } finally {
            await states.update(
                { id: state.id, leaseUntil },
                {
                    leaseUntil: null,
                    lastCollectedAt: now,
                    message: `${deferredUntil ? '等待来源窗口恢复；' : ''}发现 ${found} 条，核验 ${updated} 条，来源或仓库未完成 ${failed} 项；未通过的条目不会自动发布`,
                },
            );
        }
        return deferredUntil;
    }
}
