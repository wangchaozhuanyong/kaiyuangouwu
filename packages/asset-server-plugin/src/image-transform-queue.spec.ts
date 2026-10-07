import { describe, expect, it } from 'vitest';

import { ImageTransformBusyError, ImageTransformQueue } from './image-transform-queue';

function deferred() {
    let resolve = (_value: Buffer) => undefined as void;
    const promise = new Promise<Buffer>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

describe('bounded image transformation', () => {
    it('joins identical conversions and limits distinct concurrent loaders', async () => {
        const queue = new ImageTransformQueue(2, 1);
        const first = deferred();
        const second = deferred();
        let started = 0;
        const a = queue.run('a', () => {
            started++;
            return first.promise;
        });
        expect(queue.run('a', () => Promise.reject(new Error('duplicate')))).toBe(a);
        const b = queue.run('b', () => {
            started++;
            return second.promise;
        });
        const c = queue.run('c', () => {
            started++;
            return Promise.resolve(Buffer.from('c'));
        });
        await expect(queue.run('overflow', () => Promise.resolve(Buffer.alloc(0)))).rejects.toBeInstanceOf(
            ImageTransformBusyError,
        );
        expect(started).toBe(2);
        first.resolve(Buffer.from('a'));
        expect((await c).toString()).toBe('c');
        expect(started).toBe(3);
        second.resolve(Buffer.from('b'));
        await Promise.all([a, b]);
    });

    it('expires queued work without starting it and frees its key for a later retry', async () => {
        const queue = new ImageTransformQueue(1, 1, 10);
        const first = deferred();
        const running = queue.run('a', () => first.promise);
        let started = false;
        await expect(
            queue.run('waiting', () => {
                started = true;
                return Promise.resolve(Buffer.alloc(0));
            }),
        ).rejects.toBeInstanceOf(ImageTransformBusyError);
        expect(started).toBe(false);
        first.resolve(Buffer.alloc(0));
        await running;
        await expect(queue.run('waiting', () => Promise.resolve(Buffer.from('retry')))).resolves.toEqual(
            Buffer.from('retry'),
        );
    });

    it('releases permits and singleflight keys after a loader failure', async () => {
        const queue = new ImageTransformQueue(1);
        await expect(queue.run('a', () => Promise.reject(new Error('failed')))).rejects.toThrow('failed');
        await expect(queue.run('a', () => Promise.resolve(Buffer.from('ok')))).resolves.toEqual(
            Buffer.from('ok'),
        );
    });
});
