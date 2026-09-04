import { Inject, Injectable } from '@nestjs/common';
import {
    CacheService,
    Channel,
    EntityNotFoundError,
    EventBus,
    ID,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Repository } from 'typeorm';

import { CloudflareSaasDomainProvider } from './cloudflare-saas-domain.provider';
import { STORE_DOMAIN_PLUGIN_OPTIONS, storeDomainPermission } from './constants';
import { normalizeDomain, verificationRecordName, verificationRecordValue } from './domain-utils';
import { StoreDomain } from './entities/store-domain.entity';
import { StoreDomainChangedEvent } from './store-domain.event';
import {
    ResolvedStoreDomainPluginOptions,
    StoreDomainAutomationResult,
    TransferStoreDomainInput,
} from './types';

@Injectable()
export class StoreDomainService {
    private readonly cloudflare: CloudflareSaasDomainProvider | null;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cacheService: CacheService,
        private readonly eventBus: EventBus,
        @Inject(STORE_DOMAIN_PLUGIN_OPTIONS) private readonly options: ResolvedStoreDomainPluginOptions,
    ) {
        this.cloudflare = options.cloudflare ? new CloudflareSaasDomainProvider(options.cloudflare) : null;
    }

    async findAll(ctx: RequestContext, channelId: ID): Promise<StoreDomain[]> {
        this.assertChannelAccess(ctx, channelId, [Permission.ReadChannel, storeDomainPermission.Read]);
        return this.connection.getRepository(ctx, StoreDomain).find({
            where: { channelId },
            relations: { channel: true },
            order: { isPrimary: 'DESC', createdAt: 'ASC' },
        });
    }

    configuration() {
        return {
            cnameTarget: this.options.cnameTarget,
            routingMode: this.options.routingMode,
            automationMode: this.cloudflare ? 'CLOUDFLARE_SAAS' : 'MANUAL',
        };
    }

    async transferImpact(ctx: RequestContext, id: ID, targetChannelId: ID) {
        this.assertSuperAdmin(ctx);
        const domain = await this.findDomain(ctx, id);
        const targetChannel = await this.findChannel(ctx, targetChannelId);
        const repository = this.connection.getRepository(ctx, StoreDomain);
        const [sourceDomains, targetDomains] = await Promise.all([
            repository.find({ where: { channelId: domain.channelId }, order: { createdAt: 'ASC' } }),
            repository.find({ where: { channelId: targetChannelId }, order: { createdAt: 'ASC' } }),
        ]);
        const sameChannel = String(domain.channelId) === String(targetChannelId);
        return {
            domain,
            sourceChannel: domain.channel,
            targetChannel,
            sourceReplacementDomain:
                sourceDomains.find(
                    candidate => String(candidate.id) !== String(domain.id) && candidate.status === 'ACTIVE',
                )?.domain ?? null,
            targetPrimaryDomain: targetDomains.find(candidate => candidate.isPrimary)?.domain ?? null,
            preservesVerification: true,
            canTransfer: !sameChannel,
            blocker: sameChannel ? '域名已经属于目标店铺' : null,
        };
    }

    async transfer(ctx: RequestContext, input: TransferStoreDomainInput): Promise<StoreDomain> {
        this.assertSuperAdmin(ctx);
        const domain = await this.findDomain(ctx, input.id);
        this.assertExpectedUpdatedAt(domain.updatedAt, input.expectedUpdatedAt);
        const targetChannel = await this.findChannel(ctx, input.targetChannelId);
        if (String(domain.channelId) === String(targetChannel.id)) {
            throw new UserInputError('域名已经属于目标店铺');
        }

        const repository = this.connection.getRepository(ctx, StoreDomain);
        const sourceChannelId = domain.channelId;
        const sourceWasPrimary = domain.isPrimary;

        await repository.update(
            { channelId: targetChannel.id },
            { isPrimary: false, primaryChannelId: null },
        );
        domain.channel = targetChannel;
        domain.channelId = targetChannel.id;
        domain.isPrimary = true;
        domain.primaryChannelId = targetChannel.id;
        const saved = await repository.save(domain);

        if (sourceWasPrimary) {
            const sourceDomains = await repository.find({
                where: { channelId: sourceChannelId },
                order: { createdAt: 'ASC' },
            });
            const replacement = sourceDomains.find(candidate => candidate.status === 'ACTIVE');
            if (replacement) {
                replacement.isPrimary = true;
                replacement.primaryChannelId = replacement.channelId;
                await repository.save(replacement);
            }
        }

        await Promise.all([
            this.invalidateRoute(saved.domain),
            this.invalidateChannelRoutes(sourceChannelId),
            this.invalidateChannelRoutes(targetChannel.id),
        ]);
        await this.eventBus.publish(new StoreDomainChangedEvent(ctx, saved.domain));
        return saved;
    }

    async create(
        ctx: RequestContext,
        input: { channelId: ID; domain: string; isPrimary?: boolean | null },
    ): Promise<StoreDomain> {
        this.assertChannelAccess(ctx, input.channelId, [
            Permission.UpdateChannel,
            storeDomainPermission.Create,
        ]);
        await this.assertChannelExists(ctx, input.channelId);
        const domain = this.parseDomain(input.domain);
        const repository = this.connection.getRepository(ctx, StoreDomain);
        const existing = await repository.findOne({ where: { domain } });
        if (existing) {
            throw new UserInputError('该域名已绑定到其他店铺');
        }

        const count = await repository.count({ where: { channelId: input.channelId } });
        const isPrimary = input.isPrimary === true || count === 0;
        if (isPrimary) {
            await repository.update(
                { channelId: input.channelId },
                { isPrimary: false, primaryChannelId: null },
            );
        }

        try {
            const saved = await repository.save(
                new StoreDomain({
                    domain,
                    channelId: input.channelId,
                    isPrimary,
                    primaryChannelId: isPrimary ? input.channelId : null,
                    status: 'PENDING',
                    verificationToken: randomBytes(24).toString('hex'),
                    verifiedAt: null,
                    lastVerificationError: null,
                    provisioningMode: this.cloudflare ? 'CLOUDFLARE_SAAS' : 'MANUAL',
                    dnsManaged: false,
                    providerExternalId: null,
                    providerHostnameStatus: null,
                    providerSslStatus: null,
                    lastProvisionedAt: null,
                }),
            );
            if (this.cloudflare) {
                await this.provisionAutomatedDomain(saved, repository);
            }
            await this.invalidateRoute(domain);
            await this.eventBus.publish(new StoreDomainChangedEvent(ctx, domain));
            return saved;
        } catch (error) {
            if (this.isUniqueConstraintError(error)) {
                throw new UserInputError('该域名已绑定到其他店铺');
            }
            throw error;
        }
    }

    async verify(
        ctx: RequestContext,
        id: ID,
    ): Promise<{ success: boolean; message: string; domain: StoreDomain }> {
        const domain = await this.getForMutation(ctx, id, [
            Permission.UpdateChannel,
            storeDomainPermission.Update,
        ]);
        if (domain.status === 'ACTIVE') {
            return { success: true, message: '域名已经验证通过', domain };
        }

        const repository = this.connection.getRepository(ctx, StoreDomain);
        if (domain.provisioningMode === 'CLOUDFLARE_SAAS' && this.cloudflare) {
            const automation = await this.provisionAutomatedDomain(domain, repository);
            if (!automation?.ready) {
                return {
                    success: false,
                    message: domain.lastVerificationError ?? 'Cloudflare 域名和 SSL 证书尚未生效',
                    domain,
                };
            }
        }

        const ownership = await this.checkOwnership(domain);
        if (!ownership.ready) {
            domain.lastVerificationError = ownership.message;
            await repository.save(domain);
            return { success: false, message: ownership.message, domain };
        }

        domain.status = 'ACTIVE';
        domain.verifiedAt = new Date();
        domain.lastVerificationError = null;
        await repository.save(domain);
        await this.invalidateRoute(domain.domain);
        await this.eventBus.publish(new StoreDomainChangedEvent(ctx, domain.domain));
        return { success: true, message: '域名验证通过，可以开始接收店铺请求', domain };
    }

    async setPrimary(ctx: RequestContext, id: ID): Promise<StoreDomain> {
        const domain = await this.getForMutation(ctx, id, [
            Permission.UpdateChannel,
            storeDomainPermission.Update,
        ]);
        if (domain.status !== 'ACTIVE') {
            throw new UserInputError('域名验证通过后才能设为主域名');
        }
        const repository = this.connection.getRepository(ctx, StoreDomain);
        await repository.update(
            { channelId: domain.channelId },
            { isPrimary: false, primaryChannelId: null },
        );
        domain.isPrimary = true;
        domain.primaryChannelId = domain.channelId;
        return repository.save(domain);
    }

    async delete(ctx: RequestContext, id: ID): Promise<{ result: 'DELETED'; message: string }> {
        const domain = await this.getForMutation(ctx, id, [
            Permission.UpdateChannel,
            storeDomainPermission.Delete,
        ]);
        const repository = this.connection.getRepository(ctx, StoreDomain);
        const wasPrimary = domain.isPrimary;
        const channelId = domain.channelId;
        if (domain.provisioningMode === 'CLOUDFLARE_SAAS' && domain.providerExternalId && this.cloudflare) {
            await this.cloudflare.remove(domain.providerExternalId);
        }
        await repository.remove(domain);
        await this.invalidateRoute(domain.domain);
        await this.eventBus.publish(new StoreDomainChangedEvent(ctx, domain.domain));

        if (wasPrimary) {
            const replacement = await repository.findOne({
                where: { channelId },
                order: { status: 'ASC', createdAt: 'ASC' },
            });
            if (replacement) {
                replacement.isPrimary = true;
                replacement.primaryChannelId = replacement.channelId;
                await repository.save(replacement);
            }
        }
        return { result: 'DELETED', message: '域名已删除' };
    }

    async reconcilePending(): Promise<number> {
        if (!this.cloudflare) {
            return 0;
        }
        const repository = this.connection.rawConnection.getRepository(StoreDomain);
        const domains = await repository.find({
            where: { status: 'PENDING', provisioningMode: 'CLOUDFLARE_SAAS' },
            order: { updatedAt: 'ASC' },
            take: 25,
        });
        let reconciled = 0;
        for (const domain of domains) {
            const automation = await this.provisionAutomatedDomain(domain, repository);
            if (!automation?.ready) {
                continue;
            }
            const ownership = await this.checkOwnership(domain);
            if (!ownership.ready) {
                domain.lastVerificationError = ownership.message;
                await repository.save(domain);
                continue;
            }
            domain.status = 'ACTIVE';
            domain.verifiedAt = new Date();
            domain.lastVerificationError = null;
            await repository.save(domain);
            await this.invalidateRoute(domain.domain);
            reconciled++;
        }
        return reconciled;
    }

    async resolveRoute(domain: string): Promise<StoreDomainRoute | null> {
        const cacheKey = this.routeCacheKey(domain);
        const cached = await this.cacheService.get<CachedStoreDomainRoute>(cacheKey);
        if (cached) {
            return cached.found ? { status: cached.status, channelToken: cached.channelToken } : null;
        }

        const storeDomain = await this.connection.rawConnection.getRepository(StoreDomain).findOne({
            where: { domain },
            relations: { channel: true },
        });
        const cacheValue: CachedStoreDomainRoute = storeDomain
            ? {
                  found: true,
                  status: storeDomain.status,
                  channelToken: storeDomain.channel.token,
              }
            : { found: false, status: null, channelToken: null };
        await this.cacheService.set(cacheKey, cacheValue, {
            ttl: 30_000,
            tags: storeDomain ? [this.channelCacheTag(storeDomain.channelId)] : undefined,
        });
        return storeDomain ? { status: storeDomain.status, channelToken: storeDomain.channel.token } : null;
    }

    getVerificationRecordName(domain: StoreDomain): string {
        return verificationRecordName(domain.domain);
    }

    getVerificationRecordValue(domain: StoreDomain): string {
        return verificationRecordValue(domain.verificationToken);
    }

    invalidateChannelRoutes(channelId: ID): Promise<void> {
        return this.cacheService.invalidateTags([this.channelCacheTag(channelId)]);
    }

    invalidateDomainRoute(domain: string): Promise<void> {
        return this.invalidateRoute(domain);
    }

    private async provisionAutomatedDomain(
        domain: StoreDomain,
        repository: Repository<StoreDomain>,
    ): Promise<StoreDomainAutomationResult | null> {
        if (!this.cloudflare) {
            return null;
        }
        try {
            const result = await this.cloudflare.provision({
                domain: domain.domain,
                cnameTarget: this.options.cnameTarget,
                verificationRecordName: this.getVerificationRecordName(domain),
                verificationRecordValue: this.getVerificationRecordValue(domain),
            });
            domain.provisioningMode = 'CLOUDFLARE_SAAS';
            domain.providerExternalId = result.externalId;
            domain.dnsManaged = result.dnsManaged;
            domain.providerHostnameStatus = result.hostnameStatus;
            domain.providerSslStatus = result.sslStatus;
            domain.lastProvisionedAt = new Date();
            domain.lastVerificationError = result.ready ? null : result.message;
            await repository.save(domain);
            return result;
        } catch (error) {
            domain.provisioningMode = 'CLOUDFLARE_SAAS';
            domain.lastProvisionedAt = new Date();
            domain.lastVerificationError = this.automationError(error);
            await repository.save(domain);
            return null;
        }
    }

    private async checkOwnership(domain: StoreDomain): Promise<{ ready: boolean; message: string }> {
        const recordName = verificationRecordName(domain.domain);
        const expectedValue = verificationRecordValue(domain.verificationToken);
        try {
            const records = await this.options.resolveTxt(recordName);
            const values = records.map(parts => parts.join(''));
            return values.includes(expectedValue)
                ? { ready: true, message: '' }
                : { ready: false, message: `未找到要求的 TXT 记录：${recordName}` };
        } catch (error) {
            const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
            return {
                ready: false,
                message: code ? `DNS 查询失败（${code}），请确认 TXT 记录已生效` : 'DNS 查询失败，请稍后重试',
            };
        }
    }

    private automationError(error: unknown): string {
        const message = error instanceof Error ? error.message.trim() : '';
        return message ? `Cloudflare 自动配置失败：${message}` : 'Cloudflare 自动配置失败，请稍后重试';
    }

    private async getForMutation(
        ctx: RequestContext,
        id: ID,
        permissions: Permission[],
    ): Promise<StoreDomain> {
        const domain = await this.connection.getRepository(ctx, StoreDomain).findOne({
            where: { id },
            relations: { channel: true },
        });
        if (!domain) {
            throw new EntityNotFoundError(StoreDomain.name, id);
        }
        this.assertChannelAccess(ctx, domain.channelId, permissions);
        return domain;
    }

    private async findDomain(ctx: RequestContext, id: ID): Promise<StoreDomain> {
        const domain = await this.connection.getRepository(ctx, StoreDomain).findOne({
            where: { id },
            relations: { channel: true },
        });
        if (!domain) throw new EntityNotFoundError(StoreDomain.name, id);
        return domain;
    }

    private async findChannel(ctx: RequestContext, id: ID): Promise<Channel> {
        const channel = await this.connection.getRepository(ctx, Channel).findOne({ where: { id } });
        if (!channel) throw new EntityNotFoundError(Channel.name, id);
        return channel;
    }

    private assertExpectedUpdatedAt(current: Date, expected: Date | string): void {
        const expectedDate = expected instanceof Date ? expected : new Date(expected);
        if (!Number.isFinite(expectedDate.getTime()) || current.getTime() !== expectedDate.getTime()) {
            throw new UserInputError(
                'CONCURRENT_MODIFICATION: 域名绑定已被其他管理员更新，请重新载入后再操作',
            );
        }
    }

    private assertSuperAdmin(ctx: RequestContext): void {
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new UserInputError('只有超级管理员可以把域名转移到其他店铺');
        }
    }

    private assertChannelAccess(ctx: RequestContext, channelId: ID, permissions: Permission[]): void {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) {
            return;
        }
        if (String(ctx.channelId) !== String(channelId) || !ctx.userHasPermissions(permissions)) {
            throw new UserInputError('无权管理该店铺的域名');
        }
    }

    private async assertChannelExists(ctx: RequestContext, channelId: ID): Promise<void> {
        const channel = await this.connection
            .getRepository(ctx, Channel)
            .findOne({ where: { id: channelId } });
        if (!channel) {
            throw new EntityNotFoundError(Channel.name, channelId);
        }
    }

    private parseDomain(input: string): string {
        try {
            return normalizeDomain(input);
        } catch (error) {
            throw new UserInputError(error instanceof Error ? error.message : '域名格式不正确');
        }
    }

    private routeCacheKey(domain: string): string {
        return `StoreDomainRoute:${domain}`;
    }

    private channelCacheTag(channelId: ID): string {
        return `StoreDomainChannel:${channelId}`;
    }

    private invalidateRoute(domain: string): Promise<void> {
        return this.cacheService.delete(this.routeCacheKey(domain));
    }

    private isUniqueConstraintError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }
        const code = 'code' in error ? String(error.code) : '';
        const errno = 'errno' in error ? String(error.errno) : '';
        return (
            code === '23505' ||
            code === 'ER_DUP_ENTRY' ||
            code.startsWith('SQLITE_CONSTRAINT') ||
            errno === '1062'
        );
    }
}

export interface StoreDomainRoute {
    status: 'PENDING' | 'ACTIVE';
    channelToken: string;
}

type CachedStoreDomainRoute =
    | {
          found: true;
          status: 'PENDING' | 'ACTIVE';
          channelToken: string;
      }
    | {
          found: false;
          status: null;
          channelToken: null;
      };

export function defaultResolveTxt(hostname: string): Promise<string[][]> {
    return dns.resolveTxt(hostname);
}
