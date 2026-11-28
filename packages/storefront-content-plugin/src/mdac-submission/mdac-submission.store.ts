import type { MdacOfficialPayload, MdacSubmissionStatus } from './mdac-submission.types';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';


export interface MdacSubmissionRecord {
    id: string;
    status: MdacSubmissionStatus;
    attempts: number;
    createdAt: string;
    updatedAt: string;
    arrivalIso: string;
    payload: MdacOfficialPayload;
    channelId: string | null;
    language: string;
    referenceNo?: string;
    pin?: string;
    receiptFile?: string;
    receiptBytes?: number;
    receiptMime?: string;
    lastError?: string;
    submittedAt?: string;
    nextAttemptAt?: number;
    /** Set when the worker stopped before the official submit (dry run or captcha). */
    dryRun?: boolean;
    log: string[];
}

const lockStaleMs = 15 * 60_000;
const logLimit = 40;

/**
 * Directory-backed job store. The storefront backend is deployed as a single
 * process, so an exclusive lock file plus atomic rename gives one claimant per
 * job without another schema change.
 */
export class MdacSubmissionStore {
    private constructor(private readonly root: string) {}

    static async create(root: string): Promise<MdacSubmissionStore> {
        await mkdir(root, { recursive: true });
        return new MdacSubmissionStore(root);
    }

    private recordPath(id: string) {
        return join(this.root, `${id}.json`);
    }

    private lockPath(id: string) {
        return join(this.root, `${id}.lock`);
    }

    async create(input: {
        payload: MdacOfficialPayload;
        arrivalIso: string;
        channelId: string | null;
        language: string;
    }): Promise<MdacSubmissionRecord> {
        const now = new Date().toISOString();
        const record: MdacSubmissionRecord = {
            id: randomUUID(),
            status: 'QUEUED',
            attempts: 0,
            createdAt: now,
            updatedAt: now,
            arrivalIso: input.arrivalIso,
            payload: input.payload,
            channelId: input.channelId,
            language: input.language,
            log: [],
        };
        await this.save(record);
        return record;
    }

    async save(record: MdacSubmissionRecord): Promise<void> {
        record.updatedAt = new Date().toISOString();
        record.log = record.log.slice(-logLimit);
        const target = this.recordPath(record.id);
        const temp = `${target}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(record), 'utf8');
        await rename(temp, target);
    }

    async get(id: string): Promise<MdacSubmissionRecord | undefined> {
        if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
        try {
            return JSON.parse(await readFile(this.recordPath(id), 'utf8')) as MdacSubmissionRecord;
        } catch {
            return undefined;
        }
    }

    async findByPassport(passNo: string, arrivalIso: string): Promise<MdacSubmissionRecord | undefined> {
        for (const record of await this.all()) {
            if (
                record.payload.passNo === passNo &&
                record.arrivalIso === arrivalIso &&
                record.status !== 'FAILED'
            )
                return record;
        }
    }

    async all(): Promise<MdacSubmissionRecord[]> {
        const records: MdacSubmissionRecord[] = [];
        for (const name of await readdir(this.root)) {
            if (!name.endsWith('.json')) continue;
            const record = await this.get(name.slice(0, -5));
            if (record) records.push(record);
        }
        return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    /**
     * Claims the oldest job that is due. A stale lock from a crashed worker is
     * reclaimable so a restart does not strand a traveller.
     */
    async claimNext(now: number): Promise<MdacSubmissionRecord | undefined> {
        const candidates = (await this.all()).filter(
            item =>
                (item.status === 'QUEUED' || item.status === 'RUNNING') && (item.nextAttemptAt ?? 0) <= now,
        );
        for (const candidate of candidates) {
            if (candidate.status === 'RUNNING' && (await this.lockAge(candidate.id)) < lockStaleMs) continue;
            if (await this.lock(candidate.id)) {
                const fresh = await this.get(candidate.id);
                if (!fresh) {
                    await this.unlock(candidate.id);
                    continue;
                }
                fresh.status = 'RUNNING';
                fresh.attempts += 1;
                await this.save(fresh);
                return fresh;
            }
        }
    }

    async unlock(id: string): Promise<void> {
        await rm(this.lockPath(id), { force: true });
    }

    async writeReceipt(id: string, bytes: Buffer, mime: string): Promise<string> {
        const file = `${id}.pdf`;
        await writeFile(join(this.root, file), bytes);
        return file;
    }

    async readReceipt(id: string, file: string): Promise<Buffer | undefined> {
        if (!/^[0-9a-f-]{36}\.pdf$/.test(file) || !file.startsWith(id)) return undefined;
        try {
            return await readFile(join(this.root, file));
        } catch {
            return undefined;
        }
    }

    private async lock(id: string): Promise<boolean> {
        try {
            const handle = await open(this.lockPath(id), 'wx');
            await handle.writeFile(String(Date.now()), 'utf8');
            await handle.close();
            return true;
        } catch {
            return false;
        }
    }

    private async lockAge(id: string): Promise<number> {
        try {
            const info = await stat(this.lockPath(id));
            return Date.now() - info.mtimeMs;
        } catch {
            return Number.POSITIVE_INFINITY;
        }
    }
}
