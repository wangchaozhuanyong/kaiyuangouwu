import { normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS } from './types';

export type BatchImportErrorCode =
    'MISSING_NAME' | 'MISSING_SECRET' | 'INVALID_SECRET' | 'DUPLICATE_SECRET' | 'LIMIT_REACHED';

export interface ParsedBatchAccount {
    lineNumber: number;
    projectName: string;
    secret: string;
}

export interface BatchImportError {
    lineNumber: number;
    code: BatchImportErrorCode;
}

export interface BatchImportResult {
    accounts: ParsedBatchAccount[];
    errors: BatchImportError[];
}

export function parseBatchImport(
    input: string,
    existingSecrets: Iterable<string> = [],
    maximumAccounts = MAX_TWO_FACTOR_ACCOUNTS,
): BatchImportResult {
    const accounts: ParsedBatchAccount[] = [];
    const errors: BatchImportError[] = [];
    const seenSecrets = new Set<string>();
    for (const secret of existingSecrets) {
        try {
            seenSecrets.add(normalizeBase32Secret(secret));
        } catch {
            // Ignore malformed legacy values while still validating all new input.
        }
    }

    const lines = input.split(/\r?\n/);
    let unnamedIndex = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const lineNumber = lineIndex + 1;
        const line = lines[lineIndex].trim();
        if (!line) continue;

        const separatorIndex = line.indexOf('|');
        let projectName: string;
        let rawSecret: string;
        if (separatorIndex >= 0) {
            projectName = line.slice(0, separatorIndex).trim();
            rawSecret = line.slice(separatorIndex + 1).trim();
            if (!projectName) {
                errors.push({ lineNumber, code: 'MISSING_NAME' });
                continue;
            }
        } else {
            unnamedIndex += 1;
            projectName = `未命名-${String(unnamedIndex).padStart(3, '0')}`;
            rawSecret = line;
        }

        if (!rawSecret) {
            errors.push({ lineNumber, code: 'MISSING_SECRET' });
            continue;
        }
        if (projectName.length > 80) {
            errors.push({ lineNumber, code: 'MISSING_NAME' });
            continue;
        }

        let secret: string;
        try {
            secret = normalizeBase32Secret(rawSecret);
        } catch {
            errors.push({ lineNumber, code: 'INVALID_SECRET' });
            continue;
        }
        if (seenSecrets.has(secret)) {
            errors.push({ lineNumber, code: 'DUPLICATE_SECRET' });
            continue;
        }
        if (seenSecrets.size >= maximumAccounts) {
            errors.push({ lineNumber, code: 'LIMIT_REACHED' });
            continue;
        }

        seenSecrets.add(secret);
        accounts.push({ lineNumber, projectName, secret });
    }
    return { accounts, errors };
}
