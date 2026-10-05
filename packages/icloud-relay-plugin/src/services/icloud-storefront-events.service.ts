import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import {
    EntitySubscriberInterface,
    InsertEvent,
    QueryRunner,
    RemoveEvent,
    TransactionCommitEvent,
    TransactionRollbackEvent,
    UpdateEvent,
} from 'typeorm';

import { IcloudMailOutbox } from '../entities/icloud-mail-outbox.entity';
import { IcloudPrimaryAccount } from '../entities/icloud-primary-account.entity';
import { IcloudVirtualEmail } from '../entities/icloud-virtual-email.entity';

import { IcloudMailBridge, MailChange } from './icloud-mail-bridge';

/** Observes only committed mail metadata and access changes, across local processes. */
@Injectable()
export class IcloudStorefrontEventsService
    implements EntitySubscriberInterface, OnApplicationBootstrap, OnModuleDestroy
{
    private readonly pending = new WeakMap<QueryRunner, MailChange[]>();
    private readonly listeners = new Set<(event: MailChange | null) => void>();
    private bridge?: IcloudMailBridge;

    constructor(
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
    ) {}

    onApplicationBootstrap() {
        const options = this.config.dbConnectionOptions as {
            type?: string;
            host?: string;
            port?: number;
            database?: string;
        };
        const namespace = JSON.stringify([options.type, options.host, options.port, options.database]);
        this.bridge = new IcloudMailBridge(
            namespace,
            event => this.emit(event),
            () => this.emit(null),
        );
        this.connection.rawConnection.subscribers.push(this);
        this.bridge.start();
    }

    async onModuleDestroy() {
        const subscribers = this.connection.rawConnection.subscribers;
        const index = subscribers.indexOf(this);
        if (index >= 0) subscribers.splice(index, 1);
        this.emit(null);
        this.listeners.clear();
        await this.bridge?.stop();
    }

    subscribe(listener: (event: MailChange | null) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    get isReady() {
        return this.bridge?.connected ?? false;
    }

    afterInsert(event: InsertEvent<IcloudMailOutbox>) {
        if (event.metadata.target !== IcloudMailOutbox) return;
        const row = event.entity;
        this.enqueue(event.queryRunner, {
            kind: 'mail',
            eventId: row.eventId,
            cursor: String(row.id),
            primaryAccountId: row.primaryAccountId,
            virtualEmailId: row.virtualEmailId,
        });
    }

    afterUpdate(event: UpdateEvent<IcloudPrimaryAccount | IcloudVirtualEmail>) {
        if (
            ![IcloudPrimaryAccount, IcloudVirtualEmail].includes(
                event.metadata.target as typeof IcloudPrimaryAccount,
            )
        )
            return;
        const keys = ['status', 'masterQueryCode', 'buyerQueryCode', 'codeExpiresAt', 'lastSyncError'];
        const changed = event.updatedColumns.length
            ? event.updatedColumns.some(column => keys.includes(column.propertyName))
            : keys.some(key => Object.prototype.hasOwnProperty.call(event.entity ?? {}, key));
        if (!changed) return;
        this.enqueue(event.queryRunner, { kind: 'access', eventId: randomUUID() });
    }

    afterRemove(event: RemoveEvent<unknown>) {
        if (event.metadata.target === IcloudPrimaryAccount || event.metadata.target === IcloudVirtualEmail)
            this.enqueue(event.queryRunner, { kind: 'access', eventId: randomUUID() });
    }

    afterTransactionCommit(event: TransactionCommitEvent) {
        if (event.queryRunner.isTransactionActive) return;
        const changes = this.pending.get(event.queryRunner) ?? [];
        this.pending.delete(event.queryRunner);
        for (const change of changes) this.bridge?.publish(change);
    }

    afterTransactionRollback(event: TransactionRollbackEvent) {
        this.pending.delete(event.queryRunner);
        // A savepoint rollback may also discard notifications from earlier outer writes.
        // Reconcile only if that outer transaction subsequently commits.
        if (event.queryRunner.isTransactionActive)
            this.pending.set(event.queryRunner, [{ kind: 'access', eventId: randomUUID() }]);
    }

    private enqueue(runner: QueryRunner, event: MailChange) {
        if (!runner.isTransactionActive) {
            this.bridge?.publish(event);
            return;
        }
        const changes = this.pending.get(runner) ?? [];
        changes.push(event);
        this.pending.set(runner, changes);
    }

    private emit(event: MailChange | null) {
        for (const listener of this.listeners) listener(event);
    }
}
