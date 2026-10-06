import { Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { publicDerivativePlans, StorefrontMediaJobsService } from './storefront-media-jobs.plugin';
vi.mock('@vendure/store-management-plugin', () => ({
    StorefrontMediaDeliveryService: class {},
    StorefrontMediaManifestService: class {},
    StorefrontPromotionAccessService: class {},
    StorefrontPublicCacheInvalidatedEvent: class {},
    StoreManagementPlugin: class {},
}));
afterEach(() => vi.unstubAllEnvs());
function harness() {
    const queues = new Map<
        string,
        { process: (job: any) => Promise<unknown>; add: ReturnType<typeof vi.fn> }
    >();
    const queueService = {
        createQueue: vi.fn((options: any) => {
            const queue = { process: options.process, add: vi.fn(() => Promise.resolve(undefined)) };
            queues.set(options.name, queue);
            return Promise.resolve(queue);
        }),
    };
    const query: any = {
        getRawMany: vi.fn(() => Promise.resolve([{ host: 'shop.example', channelId: 'a' }])),
    };
    for (const key of ['select', 'addSelect', 'where', 'andWhere', 'orderBy', 'limit'])
        query[key] = () => query;
    const access = {
        resolveRequest: vi.fn(() =>
            Promise.resolve({
                ctx: { channelId: 'a' },
                channelId: 'a',
                host: 'shop.example',
            }),
        ),
    };
    const manifests = {
        get: vi.fn(() =>
            Promise.resolve({
                paths: Array.from({ length: 10 }, (_, i) => `preview/${i}.jpg`),
                uses: Array.from({ length: 10 }, (_, i) => ({ path: `preview/${i}.jpg`, kind: 'card' })),
            }),
        ),
    };
    const delivery = {
        purgeEnabled: true,
        channels: vi.fn(() => Promise.resolve(['a', 'retired-b'])),
        urls: vi.fn((id: string) => Promise.resolve([`https://${id}.example/assets/preview/a.jpg`])),
        purge: vi.fn((urls: string[]) => Promise.resolve({ status: 'purged', count: urls.length })),
    };
    const assets = { preparePublicDerivative: vi.fn(() => Promise.resolve(undefined)) };
    const events = new Subject<any>();
    const service = new StorefrontMediaJobsService(
        queueService as never,
        { ofType: () => events } as never,
        { rawConnection: { getRepository: () => ({ createQueryBuilder: () => query }) } } as never,
        access as never,
        manifests as never,
        delivery as never,
        assets as never,
        { isWorker: false } as never,
    );
    return { service, queues, queueService, access, manifests, delivery, assets, events };
}
describe('finite media job queues', () => {
    it('enumerates exactly canonical responsive presets and deduplicates repeated media uses', () => {
        const uses = (['card', 'detail', 'hero', 'icon', 'thumbnail'] as const).map(kind => ({
            path: 'preview/image.jpg',
            kind,
        }));
        const plans = publicDerivativePlans([...uses, ...uses]);
        expect(plans).toHaveLength(16);
        expect(plans.filter(plan => plan.preset.includes('icon')).map(plan => plan.quality)).toEqual([
            82, 82,
        ]);
        expect(plans.filter(plan => !plan.preset.includes('icon')).every(plan => plan.quality === 90)).toBe(
            true,
        );
        expect(plans.some(plan => plan.preset.includes('placeholder'))).toBe(false);
    });
    it('does not create queues unless explicitly enabled', async () => {
        vi.stubEnv('STOREFRONT_MEDIA_PREGENERATE', 'false');
        const test = harness();
        test.delivery.purgeEnabled = false;
        await test.service.onApplicationBootstrap();
        expect(test.queueService.createQueue).not.toHaveBeenCalled();
    });
    it('bounds transforms to 24 per job, reauthorizes current host and persists only public job identifiers', async () => {
        vi.stubEnv('STOREFRONT_MEDIA_PREGENERATE', 'true');
        const test = harness();
        await test.service.onApplicationBootstrap();
        try {
            const queue = test.queues.get('storefront-media-prepare');
            if (!queue) throw new Error('Expected media preparation queue');
            expect(
                await queue.process({ data: { channelId: 'a', host: 'shop.example', offset: 0 } }),
            ).toEqual({ prepared: 24, failed: 0 });
            expect(test.assets.preparePublicDerivative).toHaveBeenCalledTimes(24);
            expect(queue.add).toHaveBeenCalledWith(
                { channelId: 'a', host: 'shop.example', offset: 24 },
                { retries: 2 },
            );
            test.access.resolveRequest.mockResolvedValue({
                ctx: { channelId: 'other' },
                channelId: 'other',
                host: 'shop.example',
            });
            expect(
                await queue.process({ data: { channelId: 'a', host: 'shop.example', offset: 24 } }),
            ).toEqual({ prepared: 0 });
            expect(test.assets.preparePublicDerivative).toHaveBeenCalledTimes(24);
        } finally {
            test.service.onApplicationShutdown();
        }
    });
    it('purges ledger channels including removed domains and never turns a queue payload into a URL', async () => {
        vi.stubEnv('STOREFRONT_MEDIA_PREGENERATE', 'false');
        const test = harness();
        await test.service.onApplicationBootstrap();
        try {
            const queue = test.queues.get('storefront-media-purge');
            if (!queue) throw new Error('Expected media purge queue');
            expect(await queue.process({ data: { channelId: '*' } })).toEqual({ status: 'purged', count: 2 });
            expect(test.delivery.urls).toHaveBeenCalledWith('retired-b');
            expect(test.delivery.purge).toHaveBeenCalledWith([
                'https://retired-b.example/assets/preview/a.jpg',
            ]);
        } finally {
            test.service.onApplicationShutdown();
        }
    });
});
