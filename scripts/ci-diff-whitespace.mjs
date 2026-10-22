import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// A single space inside a balanced unified-diff hunk means an unchanged empty
// source line. It is patch syntax; a plus-prefixed added space remains an error.
export function patchBlankContextLines(text) {
    const blanks = new Set();
    let oldRemaining = 0;
    let newRemaining = 0;
    for (const [index, line] of text.split('\n').entries()) {
        const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(line);
        if (header) {
            if (oldRemaining || newRemaining) return new Set();
            oldRemaining = Number(header[1] ?? 1);
            newRemaining = Number(header[2] ?? 1);
            if (!Number.isSafeInteger(oldRemaining) || !Number.isSafeInteger(newRemaining)) return new Set();
            continue;
        }
        if (!oldRemaining && !newRemaining) continue;
        if (line === '\\ No newline at end of file') continue;
        if (line.startsWith(' ')) {
            oldRemaining--;
            newRemaining--;
            if (line === ' ') blanks.add(index + 1);
        } else if (line.startsWith('-')) oldRemaining--;
        else if (line.startsWith('+')) newRemaining--;
        else return new Set();
        if (oldRemaining < 0 || newRemaining < 0) return new Set();
    }
    return oldRemaining || newRemaining ? new Set() : blanks;
}

export function checkDiffWhitespace({ base, target = 'HEAD', cwd = process.cwd() }) {
    const options = {
        cwd,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
    };
    const git = args => execFileSync('git', args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const resolve = ref => git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
    const before = resolve(base);
    const after = resolve(target);
    const result = spawnSync(
        'git',
        [
            '-c',
            'core.quotePath=false',
            '-c',
            'color.ui=false',
            '-c',
            'core.whitespace=blank-at-eol,blank-at-eof,space-before-tab',
            'diff',
            '--check',
            before,
            after,
            '--',
        ],
        options,
    );
    if (result.error) throw result.error;
    if (result.status === 0) return { status: 0, report: '', validatedContextMarkers: 0 };
    if (result.status !== 2)
        return {
            status: result.status ?? 1,
            report: result.stdout + result.stderr,
            validatedContextMarkers: 0,
        };
    const patches = new Map();
    const rejected = [];
    let validatedContextMarkers = 0;
    const lines = result.stdout.split('\n');
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line) continue;
        const finding = /^(.+):(\d+): trailing whitespace\.$/u.exec(line);
        const display = lines[index + 1]?.startsWith('+') ? lines[++index] : undefined;
        let validContext = false;
        if (finding?.[1].endsWith('.patch')) {
            const file = finding[1];
            if (!patches.has(file))
                patches.set(file, patchBlankContextLines(git(['show', `${after}:${file}`])));
            validContext = patches.get(file).has(Number(finding[2]));
        }
        if (validContext) validatedContextMarkers++;
        else rejected.push(line, ...(display === undefined ? [] : [display]));
    }
    // Never reinterpret a Git diagnostic we do not understand, or any stderr.
    if (result.stderr) rejected.push(result.stderr);
    return {
        status: rejected.length || !validatedContextMarkers ? 2 : 0,
        report: rejected.join('\n'),
        validatedContextMarkers,
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const args = process.argv.slice(2);
        const base = args[args.indexOf('--base') + 1];
        if (!args.includes('--base') || !base) throw new Error('Missing comparison base');
        const result = checkDiffWhitespace({ base });
        if (result.report) process.stderr.write(result.report + '\n');
        if (result.status === 0)
            process.stdout.write(
                `Whitespace check passed; ${result.validatedContextMarkers} verified patch context markers.\n`,
            );
        process.exitCode = result.status;
    } catch {
        process.stderr.write('Unable to check committed diff whitespace.\n');
        process.exitCode = 1;
    }
}
