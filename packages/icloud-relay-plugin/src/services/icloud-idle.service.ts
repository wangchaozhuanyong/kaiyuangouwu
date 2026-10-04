import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ProcessContext, RequestContext, TransactionalConnection } from '@vendure/core';
import { ImapFlow } from 'imapflow';
import { randomUUID } from 'node:crypto';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudAccountStatus, IcloudRelayPluginOptions } from '../types';

import { IcloudCipherService } from './icloud-cipher.service';
import { IcloudImapSyncService, isIcloudAuthenticationFailure } from './icloud-imap-sync.service';

interface Watcher {
    owner: string;
    stopped: boolean;
    failures: number;
    client?: ImapFlow;
    retry?: ReturnType<typeof setTimeout>;
    renewal?: ReturnType<typeof setTimeout>;
    pending: boolean;
    busy: boolean;
}

/** One elected watcher per primary mailbox. Alias count does not create connections. */
@Injectable()
export class IcloudIdleService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly watchers = new Map<string, Watcher>();
    private stopped = false;
    private readonly revisions = new Map<string, number>();
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly cipher: IcloudCipherService,
        private readonly sync: IcloudImapSyncService,
        private readonly processContext: ProcessContext,
        @Optional() @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS) private readonly options?: IcloudRelayPluginOptions,
    ) {}

    async onApplicationBootstrap() {
        if (!this.processContext.isServer || this.options?.realtimeEnabled === false) return;
        const accounts = await this.repo().find({ where: { status: IcloudAccountStatus.ACTIVE } });
        for (const account of accounts) this.reconcile(String(account.id));
    }
    async onModuleDestroy() {
        this.stopped = true;
        await Promise.all([...this.watchers.keys()].map(id => this.stop(id)));
    }
    reconcile(id: string) {
        if (this.stopped || !this.processContext.isServer || this.options?.realtimeEnabled === false) return;
        const revision = (this.revisions.get(id) ?? 0) + 1;
        this.revisions.set(id, revision);
        void this.stop(id)
            .then(() => {
                if (this.stopped || this.revisions.get(id) !== revision) return;
                const watcher: Watcher = {
                    owner: randomUUID(),
                    stopped: false,
                    failures: 0,
                    pending: false,
                    busy: false,
                };
                this.watchers.set(id, watcher);
                void this.connect(id, watcher);
            })
            .catch(() => undefined);
    }
    private repo() {
        return this.connection.getRepository(RequestContext.empty(), IcloudPrimaryAccount);
    }
    private async stop(id: string) {
        const watcher = this.watchers.get(id);
        if (!watcher) return;
        watcher.stopped = true;
        if (watcher.retry) clearTimeout(watcher.retry);
        if (watcher.renewal) clearTimeout(watcher.renewal);
        watcher.client?.close();
        await this.repo().update(
            { id, mailWatchOwner: watcher.owner },
            { mailWatchOwner: null, mailWatchLeaseUntil: null, updatedAt: () => 'updatedAt' },
        );
        if (this.watchers.get(id) === watcher) this.watchers.delete(id);
    }
    private async claim(id: string, watcher: Watcher) {
        const now = new Date();
        const value = await this.repo()
            .createQueryBuilder()
            .update(IcloudPrimaryAccount)
            .set({
                mailWatchOwner: watcher.owner,
                mailWatchLeaseUntil: new Date(now.getTime() + 90_000),
                updatedAt: () => 'updatedAt',
            })
            .where(
                'id = :id AND status = :status AND (mailWatchLeaseUntil IS NULL OR mailWatchLeaseUntil <= :now OR mailWatchOwner = :owner)',
                { id, status: IcloudAccountStatus.ACTIVE, now, owner: watcher.owner },
            )
            .execute();
        return value.affected === 1;
    }
    private retry(id: string, watcher: Watcher) {
        if (watcher.stopped || this.stopped || watcher.retry) return;
        if (watcher.renewal) clearTimeout(watcher.renewal);
        watcher.retry = setTimeout(
            () => {
                watcher.retry = undefined;
                void this.connect(id, watcher);
            },
            Math.min(60_000, 1000 * 2 ** Math.min(watcher.failures++, 6)) + Math.random() * 500,
        );
        const client = watcher.client;
        watcher.client = undefined;
        client?.close();
    }
    private async connect(id: string, watcher: Watcher) {
        if (watcher.stopped || this.stopped) return;
        let connectingClient: ImapFlow | undefined;
        try {
            const account = await this.repo().findOneBy({ id });
            if (!account || account.status !== IcloudAccountStatus.ACTIVE) {
                await this.stop(id);
                return;
            }
            if (!(await this.claim(id, watcher))) throw new Error('idle_owned_elsewhere');
            const maximum = this.options?.maxIdleConnections ?? 16;
            if ([...this.watchers.values()].filter(w => w !== watcher && !!w.client).length >= maximum)
                throw new Error('idle_connection_limit');
            const password = this.cipher.decrypt(account.encryptedAppPassword);
            if (!password) throw new Error('idle_authorization_unavailable');
            const client = (watcher.client = new ImapFlow({
                host: account.imapHost || 'imap.mail.me.com',
                port: account.imapPort || 993,
                secure: true,
                auth: { user: account.email, pass: password },
                logger: false,
                maxIdleTime: 25 * 60_000,
            }));
            connectingClient = client;
            const reconnect = () => {
                if (watcher.client === client) this.retry(id, watcher);
            };
            client.on('error', reconnect);
            client.on('close', reconnect);
            client.on('exists', () => {
                if (watcher.client === client) this.changed(id, watcher);
            });
            await client.connect();
            if (watcher.client !== client || watcher.stopped || this.stopped) {
                client.close();
                return;
            }
            if (!client.capabilities.has('IDLE')) {
                await this.repo().update(
                    { id, mailWatchOwner: watcher.owner },
                    { lastSyncError: '邮箱服务不支持实时收信，请使用手动同步' },
                );
                await this.stop(id);
                return;
            }
            await client.mailboxOpen('INBOX');
            if (watcher.client !== client || watcher.stopped || this.stopped) {
                client.close();
                return;
            }
            watcher.failures = 0;
            this.changed(id, watcher); // One catch-up on connect/reconnect.
            const renew = async () => {
                try {
                    if (watcher.client !== client || watcher.stopped || this.stopped) return;
                    // Lease heartbeat reads no emails. Credential/status changes stop the old socket.
                    const result = await this.repo().update(
                        {
                            id,
                            mailWatchOwner: watcher.owner,
                            status: IcloudAccountStatus.ACTIVE,
                            email: account.email,
                            encryptedAppPassword: account.encryptedAppPassword,
                            imapHost: account.imapHost,
                            imapPort: account.imapPort,
                        },
                        { mailWatchLeaseUntil: new Date(Date.now() + 90_000), updatedAt: () => 'updatedAt' },
                    );
                    if (watcher.client !== client || watcher.stopped || this.stopped) return;
                    if (!result.affected) {
                        this.retry(id, watcher);
                        return;
                    }
                    if (!watcher.stopped && !this.stopped)
                        watcher.renewal = setTimeout(() => void renew(), 30_000);
                } catch {
                    if (watcher.client === client) this.retry(id, watcher);
                }
            };
            watcher.renewal = setTimeout(() => void renew(), 30_000);
        } catch (error) {
            if (connectingClient && watcher.client !== connectingClient) return;
            if (isIcloudAuthenticationFailure(error)) {
                await this.repo().update(
                    { id, mailWatchOwner: watcher.owner },
                    {
                        status: IcloudAccountStatus.AUTH_ERROR,
                        lastSyncError: '实时收信授权失效，请重新授权邮箱',
                    },
                );
                await this.stop(id);
            } else this.retry(id, watcher);
        }
    }
    private changed(id: string, watcher: Watcher) {
        if (watcher.stopped || this.stopped || !watcher.client?.usable) return;
        watcher.pending = true;
        if (watcher.busy) return;
        watcher.busy = true;
        let syncClient: ImapFlow | undefined = watcher.client;
        void (async () => {
            while (watcher.pending && !watcher.stopped && !this.stopped) {
                watcher.pending = false;
                syncClient = watcher.client;
                if (!syncClient?.usable) return;
                if (!(await this.claim(id, watcher))) throw new Error('idle_lease_lost');
                const account = await this.repo().findOneBy({ id });
                if (!account || account.status !== IcloudAccountStatus.ACTIVE) {
                    await this.stop(id);
                    return;
                }
                if (watcher.client !== syncClient || !syncClient.usable) {
                    watcher.pending = true;
                    return;
                }
                const result = await this.sync.syncAccount(RequestContext.empty(), account, syncClient);
                if (!result.success) throw new Error('idle_incremental_sync_failed');
            }
        })()
            .catch(() => {
                if (watcher.client === syncClient) this.retry(id, watcher);
            })
            .finally(() => {
                watcher.busy = false;
                if (watcher.pending && watcher.client?.usable) this.changed(id, watcher);
            });
    }
}
