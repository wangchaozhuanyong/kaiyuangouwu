import type { MdacSubmitOutcome } from './mdac-submitter';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MdacSubmissionService } from './mdac-submission.service';
import { MdacSubmissionStore } from './mdac-submission.store';
import {
    normalizeOfficialPayload,
    officialDateToIso,
    submissionWindowOpensAt,
    type MdacOfficialPayload,
} from './mdac-submission.types';

const validPayload: MdacOfficialPayload = {
    name: 'ZHANG SAN',
    passNo: 'E12345678',
    nationality: 'CHN',
    pob: 'CHN',
    dob: '01/01/1990',
    sex: '1',
    passExpDte: '01/01/2032',
    email: 'traveler@example.com',
    region: '86',
    mobile: '13800138000',
    arrDt: '20/12/2026',
    depDt: '29/12/2026',
    vesselNm: 'MH123',
    trvlMode: '1',
    embark: 'CHN',
    accommodationStay: '01',
    accommodationAddress1: '1 Jalan Bukit Bintang',
    accommodationAddress2: '',
    accommodationState: '14',
    accommodationPostcode: '55100',
    accommodationCity: 'KUALA LUMPUR',
};

const tempDirs: string[] = [];

afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempStore() {
    const dir = await mkdtemp(join(tmpdir(), 'mdac-submission-'));
    tempDirs.push(dir);
    return { dir, store: await MdacSubmissionStore.create(dir) };
}

describe('MDAC submission payload', () => {
    it('accepts a complete traveller and upper-cases the name', () => {
        const result = normalizeOfficialPayload({ ...validPayload, name: 'zhang  san' });
        expect(result.errors).toEqual([]);
        expect(result.submission?.payload.name).toBe('ZHANG SAN');
        expect(result.submission?.arrivalIso).toBe('2026-12-20');
    });

    it('rejects malformed dates, missing fields and reversed stays', () => {
        expect(normalizeOfficialPayload({ ...validPayload, dob: '1990-01-01' }).errors).toContain(
            'dob must be DD/MM/YYYY',
        );
        expect(normalizeOfficialPayload({ ...validPayload, passNo: '' }).errors).toContain(
            'passNo is required',
        );
        expect(normalizeOfficialPayload({ ...validPayload, depDt: '19/12/2026' }).errors).toContain(
            'depDt precedes arrDt',
        );
        expect(normalizeOfficialPayload({ ...validPayload, sex: '3' }).errors).toContain(
            'sex has invalid characters',
        );
    });

    it('keeps the official date round trip and the three day window', () => {
        expect(officialDateToIso('31/02/2026')).toBeNull();
        expect(officialDateToIso('20/12/2026')).toBe('2026-12-20');
        expect(submissionWindowOpensAt('2026-12-20')).toBe(Date.parse('2026-12-17T00:00:00Z'));
    });
});

describe('MDAC submission store', () => {
    it('stores one submission per passport and arrival date', async () => {
        const { store } = await tempStore();
        const record = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: '1',
            language: 'zh',
        });
        expect(await store.findByPassport('E12345678', '2026-12-20')).toMatchObject({ id: record.id });
        expect(await store.findByPassport('E12345678', '2026-12-21')).toBeUndefined();
        expect(await store.get(record.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
        expect(await store.get('../../etc/passwd')).toBeUndefined();
    });

    it('claims a job once until the worker releases the lock', async () => {
        const { store } = await tempStore();
        const record = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: null,
            language: 'en',
        });
        const claim = await store.claimNext(Date.now());
        expect(claim).toMatchObject({ id: record.id, status: 'RUNNING', attempts: 1 });
        expect(await store.claimNext(Date.now())).toBeUndefined();
        await store.unlock(record.id);
        const saved = await store.get(record.id);
        if (!saved) throw new Error('missing record');
        saved.status = 'QUEUED';
        await store.save(saved);
        expect(await store.claimNext(Date.now())).toMatchObject({ attempts: 2 });
    });

    it('writes receipts next to the job and refuses other ids', async () => {
        const { store } = await tempStore();
        const record = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: null,
            language: 'zh',
        });
        const file = await store.writeReceipt(record.id, Buffer.from('%PDF-1.4 demo'), 'application/pdf');
        expect((await store.readReceipt(record.id, file))?.toString()).toContain('PDF');
        expect(await store.readReceipt(record.id, 'other.pdf')).toBeUndefined();
    });
});

describe('MDAC submission outcomes', () => {
    const service = new MdacSubmissionService({} as never);
    type ApplyOutcome = (
        store: MdacSubmissionStore,
        record: Awaited<ReturnType<MdacSubmissionStore['create']>>,
        outcome: MdacSubmitOutcome,
    ) => Promise<void>;
    const applyOutcome: ApplyOutcome = (service as unknown as { apply: ApplyOutcome }).apply.bind(service);

    async function record(store: MdacSubmissionStore, attempts = 1) {
        const created = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: '1',
            language: 'zh',
        });
        created.attempts = attempts;
        created.status = 'RUNNING';
        await store.save(created);
        return created;
    }

    it('stores the reference, pin and receipt on success', async () => {
        const { store } = await tempStore();
        const job = await record(store);
        await applyOutcome(store, job, {
            status: 'DONE',
            referenceNo: 'MDAC123456',
            pin: 'AB12CD34',
            pdf: Buffer.from('%PDF-1.4 receipt'),
            receiptMime: 'application/pdf',
            log: ['ok'],
        });
        expect(job.status).toBe('DONE');
        expect(job.referenceNo).toBe('MDAC123456');
        expect(job.receiptBytes).toBeGreaterThan(10);
        expect(job.pin).toBe('AB12CD34');
    });

    it('retries captcha failures and stops after the attempt budget', async () => {
        const { store } = await tempStore();
        const once = await record(store);
        await applyOutcome(store, once, {
            status: 'FAILED',
            reason: 'captcha',
            detail: 'slider did not verify',
            log: [],
        });
        expect(once.status).toBe('QUEUED');
        expect(once.nextAttemptAt).toBeGreaterThan(Date.now());

        const last = await record(store, 5);
        await applyOutcome(store, last, {
            status: 'FAILED',
            reason: 'captcha',
            detail: 'slider did not verify',
            log: [],
        });
        expect(last.status).toBe('FAILED');
    });

    it('does not retry official validation rejections', async () => {
        const { store } = await tempStore();
        const job = await record(store);
        await applyOutcome(store, job, {
            status: 'FAILED',
            reason: 'validation',
            detail: 'Please enter Name.',
            log: [],
        });
        expect(job.status).toBe('FAILED');
        expect(job.lastError).toContain('validation');
    });

    it('keeps unrecognised official responses for a human check', async () => {
        const { store } = await tempStore();
        const job = await record(store);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await applyOutcome(store, job, {
            status: 'MANUAL',
            detail: 'submit response not recognised as an acknowledgement',
            log: [],
        });
        expect(job.status).toBe('MANUAL');
        expect(job.lastError).toContain('not recognised');
    });
});

describe('MDAC admin queue', () => {
    async function adminService() {
        const { dir } = await tempStore();
        process.env.STOREFRONT_MDAC_SUBMIT_DIR = dir;
        return { dir, service: new MdacSubmissionService({} as never) };
    }

    it('lists newest first and filters by status', async () => {
        const { service: admin, dir } = await adminService();
        const store = await MdacSubmissionStore.create(dir);
        const first = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: '1',
            language: 'zh',
        });
        const second = await store.create({
            payload: { ...validPayload, passNo: 'E87654321' },
            arrivalIso: '2026-12-21',
            channelId: '1',
            language: 'zh',
        });
        first.createdAt = '2026-11-01T00:00:00.000Z';
        second.createdAt = '2026-11-02T00:00:00.000Z';
        await store.save(first);
        await store.save(second);
        const all = await admin.adminList({});
        expect(all.totalItems).toBe(2);
        expect(all.items[0].passportNo).toBe('E87654321');
        expect((await admin.adminList({ status: 'DONE' })).totalItems).toBe(0);
        expect((await admin.adminList({ status: 'QUEUED' })).items).toHaveLength(2);
    });

    it('requeues a failed job with a clean attempt budget', async () => {
        const { service: admin, dir } = await adminService();
        const store = await MdacSubmissionStore.create(dir);
        const job = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: '1',
            language: 'zh',
        });
        job.status = 'FAILED';
        job.attempts = 5;
        job.lastError = 'captcha rejected';
        await store.save(job);
        const retried = await admin.retry(job.id);
        expect(retried).toMatchObject({ status: 'QUEUED', attempts: 0 });
        expect(retried?.lastError).toBeUndefined();
    });

    it('refuses to retry a completed job and stops queued work', async () => {
        const { service: admin, dir } = await adminService();
        const store = await MdacSubmissionStore.create(dir);
        const done = await store.create({
            payload: validPayload,
            arrivalIso: '2026-12-20',
            channelId: '1',
            language: 'zh',
        });
        done.status = 'DONE';
        await store.save(done);
        expect(await admin.retry(done.id)).toBeUndefined();
        expect(await admin.cancel(done.id)).toBeUndefined();

        const queued = await store.create({
            payload: { ...validPayload, passNo: 'E55555555' },
            arrivalIso: '2026-12-22',
            channelId: '1',
            language: 'zh',
        });
        expect((await admin.cancel(queued.id))?.status).toBe('FAILED');
    });
});
