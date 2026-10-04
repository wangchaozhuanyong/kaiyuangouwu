import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const registryPath = 'docs/design-preview-baselines.json';
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const digest = value => createHash('sha256').update(value).digest('hex');

export function compareDesignFiles(expected, actual) {
    return Object.keys(expected).filter(
        file => !actual[file] || digest(expected[file]) !== digest(actual[file]),
    );
}

async function readSources(root, files) {
    return Object.fromEntries(
        await Promise.all(
            files.map(async file => [file, await readFile(path.join(root, file)).catch(() => null)]),
        ),
    );
}

async function previewDirectory(url, root) {
    const target = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
        throw new Error('此检查只核对本地预览目录；线上版本不能作为本地最新设计的依据。');
    }
    const port = target.port || (target.protocol === 'https:' ? '443' : '80');
    const pids = [
        ...new Set(
            execFileSync('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
                .trim()
                .split(/\s+/u)
                .filter(Boolean),
        ),
    ];
    const processes = await Promise.all(
        pids.map(async pid => {
            const details = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {
                encoding: 'utf8',
            });
            const directory = details
                .split('\n')
                .find(line => line.startsWith('n'))
                ?.slice(1);
            const cwd = directory ? await realpath(directory) : null;
            const worktreeRoot = cwd ? await realpath(git(cwd, ['rev-parse', '--show-toplevel'])) : null;
            return { pid: Number(pid), cwd, worktreeRoot, matches: worktreeRoot === root };
        }),
    );
    return {
        url: target.href,
        processes,
        matches: processes.length > 0 && processes.every(item => item.matches),
    };
}

export async function auditDesignPreview({
    root = process.cwd(),
    surface = 'homepage-intro',
    previewUrl,
} = {}) {
    root = await realpath(git(root, ['rev-parse', '--show-toplevel']));
    const commonGitDirectory = await realpath(
        git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    );
    const sharedRoot = path.dirname(commonGitDirectory);
    // Always use the primary repository's registry, even when an older worktree owns this script.
    const registry = JSON.parse(await readFile(path.join(sharedRoot, registryPath), 'utf8'));
    if (registry.schemaVersion !== 1 || !registry.surfaces?.[surface]) {
        throw new Error(
            `没有登记 ${surface} 的设计来源。先查用户最新要求及已有成果，不得自动使用主线或线上旧版。`,
        );
    }
    const baseline = registry.surfaces[surface];
    for (const file of baseline.sourceFiles) {
        if (path.isAbsolute(file) || file.split(/[\\/]/u).includes('..')) {
            throw new Error(`设计来源文件必须位于项目内：${file}`);
        }
    }
    const expected = Object.fromEntries(
        baseline.sourceFiles.map(file => [
            file,
            execFileSync('git', ['-C', root, 'show', `${baseline.implementationCommit}:${file}`]),
        ]),
    );
    const changedFiles = compareDesignFiles(expected, await readSources(root, baseline.sourceFiles));
    const issues = changedFiles.length ? [`演示源码与已登记设计不一致：${changedFiles.join(', ')}`] : [];
    const worktrees = git(root, ['worktree', 'list', '--porcelain'])
        .split('\n')
        .filter(line => line.startsWith('worktree '))
        .map(line => line.slice(9));
    const inventory = await Promise.all(
        worktrees.map(async directory => {
            const actual = await readSources(directory, baseline.sourceFiles);
            const changes = git(directory, ['status', '--short', '--', ...baseline.sourceFiles]);
            return {
                root: directory,
                head: git(directory, ['rev-parse', '--short', 'HEAD']),
                matchesBaseline: compareDesignFiles(expected, actual).length === 0,
                relatedChanges: changes ? changes.split('\n') : [],
            };
        }),
    );
    let preview = null;
    if (previewUrl) {
        try {
            preview = await previewDirectory(previewUrl, root);
            if (!preview.matches) issues.push('预览服务的工作目录与演示代码工作区不一致。');
        } catch (error) {
            issues.push(`无法核对预览目录：${error.message}`);
        }
    }
    return {
        ok: issues.length === 0,
        checked: 'design-source-files-and-optional-local-server-directory',
        registry: path.join(sharedRoot, registryPath),
        surface,
        baseline,
        candidate: {
            root,
            branch: git(root, ['branch', '--show-current']),
            head: git(root, ['rev-parse', '--short', 'HEAD']),
            changedFiles,
        },
        preview,
        matchingWorktrees: inventory.filter(item => item.matchesBaseline),
        relatedWipWorktrees: inventory.filter(item => item.relatedChanges.length > 0),
        issues,
        note: '源码一致不等于画面验收通过。仍须核对实际客户端、后台预览、配置和截图；文件差异需按本次授权核对，不能删掉新代码来通过检查。',
    };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = {};
    const names = { '--root': 'root', '--surface': 'surface', '--preview-url': 'previewUrl' };
    try {
        for (let index = 2; index < process.argv.length; index += 2) {
            const name = names[process.argv[index]];
            const value = process.argv[index + 1];
            if (!name || !value || value.startsWith('--'))
                throw new Error('参数：--root <工作区> --surface <页面> --preview-url <本地地址>');
            options[name] = value;
        }
        const result = await auditDesignPreview(options);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
