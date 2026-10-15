import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import {
    CatalogSyncRule,
    ChannelService,
    ConfigService,
    EventBus,
    JobQueue,
    JobQueueService,
    Logger,
    Permission,
    RequestContextService,
    ScheduledTask,
    TransactionalConnection,
    User,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Subscription } from 'rxjs';
import { Brackets, IsNull, LessThan, MoreThan } from 'typeorm';

import { CatalogSyncService } from './catalog-sync.service';

const changes = new Set([
    'ProductEvent',
    'ProductVariantEvent',
    'ProductVariantPriceEvent',
    'CollectionEvent',
    'CollectionModificationEvent',
    'ChannelEvent',
    'ShippingMethodEvent',
    'StorefrontDataChangedEvent',
    'RoleEvent',
    'AdministratorEvent',
]);

@Injectable()
export class CatalogSyncQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
    private queue: JobQueue<{ ruleId: string }>;
    private subscription?: Subscription;
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly jobs: JobQueueService,
        private readonly events: EventBus,
        private readonly contexts: RequestContextService,
        private readonly channels: ChannelService,
        private readonly sync: CatalogSyncService,
    ) {}

    async onApplicationBootstrap() {
        this.queue = await this.jobs.createQueue({
            name: 'catalog-continuous-sync',
            process: job => this.process(job.data.ruleId),
        });
        this.sync.registerEnqueuer(id =>
            this.queue.add({ ruleId: String(id) }, { retries: 2 }).then(() => undefined),
        );
        // filter() delivers committed changes only. Targets cannot themselves be sources.
        this.subscription = this.events
            .filter(event => changes.has(event.constructor.name))
            .subscribe(event => {
                const change = event as {
                    ctx?: { channelId?: ID; channel?: { code: string } };
                    topics?: string[];
                    options?: { userIds?: ID[]; orderIds?: ID[]; channelIds?: ID[] };
                };
                if (
                    event.constructor.name === 'StorefrontDataChangedEvent' &&
                    (!change.topics?.some(topic => ['catalog', 'config'].includes(topic)) ||
                        change.options?.userIds?.length ||
                        change.options?.orderIds?.length)
                )
                    return;
                if (
                    event.constructor.name === 'StorefrontDataChangedEvent' &&
                    change.options?.channelIds?.length
                ) {
                    void Promise.all(change.options.channelIds.map(id => this.schedule(id))).catch(() =>
                        Logger.error('Catalog synchronization enqueue failed', 'CatalogSync'),
                    );
                    return;
                }
                const ctx = change.ctx;
                const global =
                    !ctx?.channelId ||
                    ctx.channel?.code === '__default_channel__' ||
                    ['ChannelEvent', 'RoleEvent', 'AdministratorEvent'].includes(event.constructor.name);
                void (global ? this.scan() : this.schedule(ctx?.channelId)).catch(() =>
                    Logger.error(
                        'Catalog synchronization enqueue failed; scheduled reconciliation will recover',
                        'CatalogSync',
                    ),
                );
            });
        await this.scan();
    }
    onApplicationShutdown() {
        this.subscription?.unsubscribe();
    }

    async schedule(channelId?: ID, after = 0) {
        const rules = await this.connection.rawConnection.getRepository(CatalogSyncRule).find({
            where: {
                enabled: true,
                ...(channelId ? { sourceChannelId: channelId } : { id: MoreThan(after) }),
            },
            ...(channelId ? {} : { take: 100 }),
            order: { id: 'ASC' },
        });
        for (const rule of rules) {
            // Platform events and periodic scans cover changes whose source is not carried in ctx.
            if (channelId && String(channelId) !== String(rule.sourceChannelId)) continue;
            await this.connection.rawConnection
                .getRepository(CatalogSyncRule)
                .increment({ id: rule.id }, 'generation', 1);
            await this.queue.add({ ruleId: String(rule.id) }, { retries: 2 });
        }
        return {
            scanned: rules.length,
            scanCursor: !channelId && rules.length === 100 ? Number(rules[rules.length - 1].id) : 0,
        };
    }

    async scan(after = 0) {
        let cursor = after;
        let scanned = 0;
        do {
            const page = await this.schedule(undefined, cursor);
            cursor = page.scanCursor;
            scanned += page.scanned;
        } while (cursor && scanned < 10000);
        return { scanned, scanCursor: cursor };
    }

    private async process(ruleId: ID) {
        const repo = this.connection.rawConnection.getRepository(CatalogSyncRule);
        const now = new Date();
        const leaseToken = randomUUID();
        const leased = await repo
            .createQueryBuilder()
            .update(CatalogSyncRule)
            .set({ leaseUntil: new Date(now.getTime() + 60_000), leaseToken })
            .where({ id: ruleId, enabled: true })
            .andWhere(
                new Brackets(where =>
                    where.where({ leaseUntil: IsNull() }).orWhere({ leaseUntil: LessThan(now) }),
                ),
            )
            .execute();
        if (leased.affected !== 1) return;
        let more = false;
        try {
            const rule = await repo.findOneByOrFail({ id: ruleId });
            if (!rule.cursor && rule.state === 'COMPLETE' && rule.completedGeneration >= rule.generation)
                return;
            const actor = await this.connection.rawConnection.getRepository(User).findOne({
                where: { id: rule.actorUserId, deletedAt: IsNull() },
                relations: { roles: { channels: true } },
            });
            const preliminary = await this.contexts.create({ apiType: 'admin' });
            const platform = await this.channels.getDefaultChannel(preliminary);
            const ctx = await this.contexts.create({
                apiType: 'admin',
                channelOrToken: platform,
                user: actor ?? undefined,
            });
            if (
                !actor ||
                !ctx.userHasPermissions([Permission.SuperAdmin, 'ManagePlatformCatalog' as Permission])
            )
                throw new UserInputError('同步执行账号失效或已失去平台商品管理权限');
            more = await this.sync.reconcile(ctx, rule.id, leaseToken);
        } catch (error) {
            await repo.update(
                { id: ruleId, enabled: true, leaseToken },
                {
                    ...(error instanceof UserInputError && error.message.includes('执行账号')
                        ? { enabled: false, state: 'DISABLED' as const }
                        : { state: 'PARTIAL' as const }),
                    error:
                        error instanceof UserInputError
                            ? error.message
                            : '同步任务失败，请检查服务日志并重新对账',
                },
            );
            throw error;
        } finally {
            await repo.update({ id: ruleId, leaseToken }, { leaseUntil: null, leaseToken: null });
        }
        if (more) await this.queue.add({ ruleId: String(ruleId) }, { retries: 2 });
    }
}

export const reconcileCatalogSyncTask = new ScheduledTask({
    id: 'reconcile-catalog-continuous-sync',
    description: 'Recover and reconcile opt-in category synchronization',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector }) {
        const previous = await injector
            .get(ConfigService)
            .schedulerOptions.schedulerStrategy.getTask('reconcile-catalog-continuous-sync');
        return injector.get(CatalogSyncQueueService).scan(Number(previous?.lastResult?.scanCursor ?? 0));
    },
});
