import { Inject, Injectable, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ProcessContext, RequestContext, TransactionalConnection } from '@vendure/core';
import { createHmac, randomUUID } from 'node:crypto';
import { IsNull } from 'typeorm';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';
import { IcloudMailOutbox } from '../entities/icloud-mail-outbox.entity';
import { IcloudRelayPluginOptions } from '../types';

export function mailEventPayload(row: IcloudMailOutbox) {
    return {
        schemaVersion: 1,
        eventId: row.eventId,
        primaryAccountId: row.primaryAccountId,
        virtualEmailId: row.virtualEmailId,
        occurredAt: row.createdAt.toISOString(),
    };
}

@Injectable()
export class IcloudMailEventsService implements OnApplicationBootstrap, OnModuleDestroy {
    private running = false;
    private requested = false;
    private stopped = false;
    private retry?: ReturnType<typeof setTimeout>;
    private failures = 0;
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly processContext: ProcessContext,
        @Optional() @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS) private readonly options?: IcloudRelayPluginOptions,
    ) {}

    record(ctx: RequestContext, primaryAccountId: string, virtualEmailId: string | null) {
        return this.connection.getRepository(ctx, IcloudMailOutbox).save(
            new IcloudMailOutbox({
                eventId: randomUUID(),
                primaryAccountId,
                virtualEmailId,
                deliveredAt: null,
            }),
        );
    }

    onApplicationBootstrap() {
        if (this.processContext.isServer) this.kick();
    }
    onModuleDestroy() {
        this.stopped = true;
        if (this.retry) clearTimeout(this.retry);
    }

    /** Run on a committed insertion, startup recovery, or failed-delivery retry only. */
    kick() {
        this.requested = true;
        if (this.running || this.stopped || !this.destination()) return;
        if (this.retry) {
            clearTimeout(this.retry);
            this.retry = undefined;
        }
        this.running = true;
        this.requested = false;
        void this.drain()
            .catch(() => {
                // Backoff is for a failed notification, never a mailbox polling timer.
                if (!this.stopped)
                    this.retry = setTimeout(
                        () => this.kick(),
                        Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6)),
                    );
            })
            .finally(() => {
                this.running = false;
                if (this.requested && !this.retry) this.kick();
            });
    }

    private destination() {
        const secret = this.options?.mailWebhookSecret;
        try {
            const url = new URL(this.options?.mailWebhookUrl ?? '');
            if (
                url.protocol !== 'https:' ||
                url.username ||
                url.password ||
                url.hash ||
                url.search ||
                !secret ||
                secret.length < 32
            )
                return null;
            return { url: url.toString(), secret };
        } catch {
            return null;
        }
    }

    private async drain() {
        const destination = this.destination();
        if (!destination) return;
        const repo = this.connection.getRepository(RequestContext.empty(), IcloudMailOutbox);
        while (!this.stopped) {
            const rows = await repo.find({
                where: { deliveredAt: IsNull() },
                order: { id: 'ASC' },
                take: 100,
            });
            if (!rows.length) {
                this.failures = 0;
                return;
            }
            for (const row of rows) {
                const body = JSON.stringify(mailEventPayload(row));
                const timestamp = String(Date.now());
                const signature = createHmac('sha256', destination.secret)
                    .update(`${timestamp}.${body}`)
                    .digest('hex');
                const response = await fetch(destination.url, {
                    method: 'POST',
                    redirect: 'error',
                    headers: {
                        'content-type': 'application/json',
                        'x-mail-timestamp': timestamp,
                        'x-mail-signature': signature,
                    },
                    body,
                    signal: AbortSignal.timeout(15_000),
                });
                if (!response.ok) throw new Error('mail_notification_failed');
                const receipt = (await response.json()) as {
                    success?: unknown;
                    data?: { accepted?: unknown };
                };
                if (receipt?.success !== true || receipt?.data?.accepted !== true)
                    throw new Error('mail_notification_unconfirmed');
                await repo.update({ id: row.id, deliveredAt: IsNull() }, { deliveredAt: new Date() });
                this.failures = 0;
            }
        }
    }
}
