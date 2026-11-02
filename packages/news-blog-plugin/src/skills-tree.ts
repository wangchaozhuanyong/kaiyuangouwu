import { SkillDeferred } from './skill-deferral';
import { BlogSkillsHttp } from './skills-http';
import { fingerprint, parseSkillDocument, SkillDiscovery } from './skills-source';

export type SkillTreeEntry = { path: string; type: string; sha: string; size?: number; mode: string };
type Tree = { truncated: boolean; tree: SkillTreeEntry[] };
/** Large repositories are read by their actual skills subtree; the 2MB transport limit stays intact. */
export async function readSkillTree(
    http: BlogSkillsHttp,
    repository: string,
    sha: string,
): Promise<SkillTreeEntry[]> {
    if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !/^[a-f0-9]{40}$/u.test(sha))
        throw new Error('仓库固定目录版本无效');
    try {
        const tree = await http.json<Tree>(`/repos/${repository}/git/trees/${sha}?recursive=1`, 'discovery');
        if (!tree.truncated && Array.isArray(tree.tree)) return tree.tree;
    } catch (error) {
        if (error instanceof SkillDeferred) throw error;
    }
    const root = await http.json<Tree>(`/repos/${repository}/git/trees/${sha}`, 'discovery');
    if (root.truncated || !Array.isArray(root.tree)) throw new Error('仓库根目录不完整');
    for (const name of ['skills', '.agents', '.claude']) {
        const folder = root.tree.find(
            x => x.path === name && x.type === 'tree' && /^[a-f0-9]{40}$/u.test(x.sha),
        );
        if (!folder) continue;
        try {
            const branch = await http.json<Tree>(
                `/repos/${repository}/git/trees/${folder.sha}?recursive=1`,
                'discovery',
            );
            if (branch.truncated || !Array.isArray(branch.tree)) continue;
            if (branch.tree.some(x => /(?:^|\/)SKILL\.md$/u.test(x.path) && x.mode !== '120000'))
                return [
                    ...root.tree.filter(x => x.type === 'blob'),
                    ...branch.tree.map(x => ({ ...x, path: `${name}/${x.path}` })),
                ];
        } catch (error) {
            if (error instanceof SkillDeferred) throw error;
        }
    }
    throw new Error('未找到大小受限且完整的技能目录');
}
/** Folder names are not Skill identities. Match real front matter and reject conflicting duplicate names. */
export async function rankedSkillDocuments(
    http: BlogSkillsHttp,
    repository: string,
    commit: string,
    tree: SkillTreeEntry[],
    discoveries: SkillDiscovery[],
) {
    const wanted = new Set(discoveries.map(x => x.slug));
    const files = tree
        .filter(
            x =>
                x.type === 'blob' &&
                x.mode !== '120000' &&
                /(?:^|\/)SKILL\.md$/u.test(x.path) &&
                (x.size ?? 0) <= 55000 &&
                !/(?:^|\/)(?:node_modules|vendor|fixtures|tests?)(?:\/|$)/iu.test(x.path),
        )
        .sort(
            (a, b) =>
                Number(wanted.has(b.path.split('/').at(-2) ?? '')) -
                    Number(wanted.has(a.path.split('/').at(-2) ?? '')) ||
                a.path.length - b.path.length ||
                a.path.localeCompare(b.path),
        )
        .slice(0, 64);
    const matches = new Map<
        string,
        Array<{ file: SkillTreeEntry; body: string; parsed: { name: string; description: string } }>
    >();
    for (let offset = 0; offset < files.length; offset += 4) {
        const results = await Promise.allSettled(
            files.slice(offset, offset + 4).map(async file => {
                const body = await http.document(repository, commit, file.path);
                const parsed = parseSkillDocument(body);
                return parsed && wanted.has(parsed.name) ? { file, body, parsed } : null;
            }),
        );
        for (const result of results)
            if (result.status === 'fulfilled' && result.value) {
                const value = result.value;
                matches.set(value.parsed.name, [...(matches.get(value.parsed.name) ?? []), value]);
            }
    }
    return new Map(
        [...matches.entries()]
            .filter(([, rows]) => new Set(rows.map(x => fingerprint(x.body))).size === 1)
            .map(([name, rows]) => [name, rows[0]]),
    );
}
