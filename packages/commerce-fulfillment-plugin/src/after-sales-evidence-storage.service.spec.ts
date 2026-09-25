import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';

import { AfterSalesEvidenceStorageService, MAX_EVIDENCE_BYTES } from './after-sales-evidence-storage.service';
import {
    EVIDENCE_DRAFT_RETENTION_MS,
    EVIDENCE_RETENTION_MS,
    evidenceExpiresAt,
} from './after-sales-evidence.service';
import { AfterSalesRequest } from './entities/after-sales-request.entity';

afterEach(() => vi.useRealTimers());

it('stores re-encoded private evidence without upload paths or EXIF and verifies bytes on read', async () => {
    const parent = path.resolve(__dirname, '../artifacts/evidence-storage-tests');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'case-'));
    const storage = new AfterSalesEvidenceStorageService({ rootDirectory: root, production: false });
    try {
        const source = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#fff' } })
            .jpeg()
            .withMetadata({ exif: { IFD0: { Artist: 'synthetic-private-metadata' } } })
            .toBuffer();
        const prepared = await storage.prepare({
            filename: '../../outside.jpg',
            mimetype: 'image/jpeg',
            createReadStream: () => Readable.from(source),
        });
        expect(prepared.storageKey).toMatch(/^after-sales\/[a-f0-9-]+\.jpg$/);
        await storage.write(prepared.storageKey, prepared.bytes);
        expect(
            (
                await sharp(
                    await storage.read(prepared.storageKey, prepared.bytes.length, prepared.sha256),
                ).metadata()
            ).exif,
        ).toBeUndefined();
        await expect(
            storage.read(prepared.storageKey, prepared.bytes.length, 'wrong-digest'),
        ).rejects.toThrow('integrity');
        await expect(storage.write('../outside.jpg', source)).rejects.toThrow('storage key');
        await storage.remove(prepared.storageKey);
        await expect(readFile(path.join(root, prepared.storageKey))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await storage.remove(prepared.storageKey);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

it('rejects non-image content and oversized streams before storage', async () => {
    const storage = new AfterSalesEvidenceStorageService({ production: false });
    await expect(
        storage.prepare({
            filename: 'fake.png',
            mimetype: 'image/png',
            createReadStream: () => Readable.from(Buffer.from('<svg onload="alert(1)"/>')),
        }),
    ).rejects.toThrow();
    await expect(
        storage.prepare({
            filename: 'huge.png',
            mimetype: 'image/png',
            createReadStream: () => Readable.from(Buffer.alloc(MAX_EVIDENCE_BYTES + 1)),
        }),
    ).rejects.toThrow('5MB');
});

it('expires signed links after five minutes and rejects a changed signature or host', () => {
    const storage = new AfterSalesEvidenceStorageService({ production: false });
    vi.useFakeTimers();
    const url = storage.sign({ id: '1', channelId: '2', customerId: '3', host: 'store.test' });
    if (!url) throw new Error('Expected an evidence link');
    const token = url.split('/').at(-1);
    if (!token) throw new Error('Expected an evidence token');
    expect(storage.verify(token, 'store.test')?.id).toBe('1');
    expect(storage.verify(token, 'other.test')).toBeUndefined();
    expect(storage.verify(`${token}x`, 'store.test')).toBeUndefined();
    vi.advanceTimersByTime(300_000);
    expect(storage.verify(token, 'store.test')).toBeUndefined();
});

it('keeps open cases without an expiry and starts the 180-day clock at the appropriate closing event', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const closedAt = new Date('2026-09-24T00:00:00Z');
    const draft = { createdAt, requestId: null, request: null };
    expect(evidenceExpiresAt(draft)?.getTime()).toBe(createdAt.getTime() + EVIDENCE_DRAFT_RETENTION_MS);
    for (const [state, field] of [
        ['COMPLETED', 'completedAt'],
        ['CANCELLED', 'cancelledAt'],
        ['REJECTED', 'respondedAt'],
    ]) {
        const request = { state, [field]: closedAt } as unknown as AfterSalesRequest;
        expect(evidenceExpiresAt({ ...draft, requestId: '1', request })?.getTime()).toBe(
            closedAt.getTime() + EVIDENCE_RETENTION_MS,
        );
    }
    for (const state of ['PENDING', 'APPROVED', 'COMPLETED']) {
        expect(
            evidenceExpiresAt({ ...draft, requestId: '1', request: { state } as AfterSalesRequest }),
        ).toBeNull();
    }
});
