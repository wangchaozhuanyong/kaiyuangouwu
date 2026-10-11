import { Subject } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { SearchIndexCompletedEvent } from '../../../event-bus/events/search-index-completed-event';

import { SearchIndexService } from './search-index.service';

vi.mock('./indexer.controller', () => ({ IndexerController: class {} }));
afterEach(() => vi.restoreAllMocks());

async function harness() {
    let process!: (job: any) => Promise<unknown>;
    const publish = vi.fn().mockResolvedValue(undefined);
    const controller = { updateProduct: vi.fn(), reindex: vi.fn() };
    const ctx = { channelId: 'synthetic-store' } as RequestContext;
    vi.spyOn(RequestContext, 'deserialize').mockReturnValue(ctx);
    const service = new SearchIndexService(
        {
            createQueue: vi.fn(options => {
                process = options.process;
                return Promise.resolve({ add: vi.fn() });
            }),
        } as never,
        controller as never,
        { publish } as never,
    );
    await service.onModuleInit();
    const job = (type = 'update-product') => ({
        data: { type, ctx: {}, productId: 'synthetic-product' },
        setProgress: vi.fn(),
    });
    return { process, publish, controller, ctx, job };
}

it('publishes completion only after the index operation has succeeded', async () => {
    const test = await harness();
    let finish!: (value: boolean) => void;
    test.controller.updateProduct.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    const work = test.process(test.job());
    expect(test.publish).not.toHaveBeenCalled();
    finish(true);
    await expect(work).resolves.toBe(true);
    expect(test.publish).toHaveBeenCalledExactlyOnceWith(expect.any(SearchIndexCompletedEvent));
    expect(test.publish.mock.calls[0][0]).toMatchObject({ ctx: test.ctx, operation: 'update-product' });
});

it.each(['false', 'reject'])('does not publish successful completion after %s', async outcome => {
    const test = await harness();
    if (outcome === 'false') {
        test.controller.updateProduct.mockResolvedValue(false);
        await expect(test.process(test.job())).resolves.toBe(false);
    } else {
        test.controller.updateProduct.mockRejectedValue(new Error('synthetic index write failed'));
        await expect(test.process(test.job())).rejects.toThrow('synthetic index write failed');
    }
    expect(test.publish).not.toHaveBeenCalled();
});

it('waits for reindex completion rather than publishing from a progress update', async () => {
    const test = await harness();
    const progress = new Subject<{ total: number; completed: number; duration: number }>();
    test.controller.reindex.mockReturnValue(progress);
    const job = test.job('reindex');
    const work = test.process(job);
    progress.next({ total: 2, completed: 1, duration: 1 });
    expect(job.setProgress).toHaveBeenCalledWith(50);
    expect(test.publish).not.toHaveBeenCalled();
    progress.next({ total: 2, completed: 2, duration: 2 });
    progress.complete();
    await expect(work).resolves.toMatchObject({ success: true, indexedItemCount: 2 });
    expect(test.publish).toHaveBeenCalledOnce();
});

it('does not publish completion if a reindex stream fails after progress', async () => {
    const test = await harness();
    const progress = new Subject<{ total: number; completed: number; duration: number }>();
    test.controller.reindex.mockReturnValue(progress);
    const work = test.process(test.job('reindex'));
    const failure = expect(work).rejects.toThrow('synthetic reindex failed');
    progress.next({ total: 2, completed: 1, duration: 1 });
    progress.error(new Error('synthetic reindex failed'));
    await failure;
    expect(test.publish).not.toHaveBeenCalled();
});
