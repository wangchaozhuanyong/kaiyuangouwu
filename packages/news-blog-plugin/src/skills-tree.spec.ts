import { describe, expect, it, vi } from 'vitest';

import { rankedSkillDocuments, readSkillTree, SkillTreeEntry } from './skills-tree';
const body = (name: string) =>
    `---\nname: ${name}\ndescription: Review supplied frontend code using explicit project requirements.\n---\n` +
    'Synthetic document evidence for name resolution tests only. '.repeat(10);
const file = (path: string): SkillTreeEntry => ({
    path,
    type: 'blob',
    sha: 'a'.repeat(40),
    mode: '100644',
    size: 800,
});
describe('bounded public Skill directories', () => {
    it('reads an actual skills subtree when a complete repository exceeds the transport limit', async () => {
        const root = 'a'.repeat(40);
        const branch = 'b'.repeat(40);
        const http = {
            json: vi.fn((path: string) => {
                if (path.endsWith(`${root}?recursive=1`))
                    return Promise.reject(new Error('Synthetic 2MB boundary'));
                if (path.endsWith(root))
                    return Promise.resolve({
                        tree: [{ path: 'skills', type: 'tree', sha: branch }, file('README.md')],
                    });
                return Promise.resolve({ tree: [file('source-test/SKILL.md')], truncated: false });
            }),
        };
        const files = await readSkillTree(http as never, 'owner/repo', root);
        expect(files.map(x => x.path)).toEqual(['README.md', 'skills/source-test/SKILL.md']);
        expect(http.json).toHaveBeenCalledTimes(3);
        expect(http.json).toHaveBeenLastCalledWith(
            `/repos/owner/repo/git/trees/${branch}?recursive=1`,
            'discovery',
        );
    });
    it('resolves the front-matter identity when directory names differ and rejects conflicting copies', async () => {
        const documents = new Map([
            ['skills/react-guidance/SKILL.md', body('branded-react-guidance')],
            ['skills/other/SKILL.md', body('other-skill')],
            ['tests/fixture/SKILL.md', body('branded-react-guidance')],
        ]);
        const http = {
            document: vi.fn((_repo, _commit, path: string) => Promise.resolve(documents.get(path) ?? '')),
        };
        const discoveries = [{ repository: 'owner/repo', slug: 'branded-react-guidance', rankings: [] }];
        const result = await rankedSkillDocuments(
            http as never,
            'owner/repo',
            'c'.repeat(40),
            [...documents.keys()].map(file),
            discoveries,
        );
        expect(result.get('branded-react-guidance')?.file.path).toBe('skills/react-guidance/SKILL.md');
        expect(http.document).toHaveBeenCalledTimes(2);
        documents.set('SKILL.md', body('branded-react-guidance') + ' Conflicting instructions.');
        expect(
            (
                await rankedSkillDocuments(
                    http as never,
                    'owner/repo',
                    'c'.repeat(40),
                    [...documents.keys()].map(file),
                    discoveries,
                )
            ).size,
        ).toBe(0);
    });
});
