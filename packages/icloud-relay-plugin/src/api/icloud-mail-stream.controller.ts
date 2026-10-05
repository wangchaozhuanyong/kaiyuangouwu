import { Body, Controller, Inject, Optional, Post, Req, Res } from '@nestjs/common';
import { RequestContextService, TransactionalConnection } from '@vendure/core';
import type { Request, Response } from 'express';
import { MoreThan } from 'typeorm';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';
import { IcloudMailOutbox } from '../entities/icloud-mail-outbox.entity';
import { MailChange } from '../services/icloud-mail-bridge';
import { IcloudPublicQueryService } from '../services/icloud-public-query.service';
import { IcloudStorefrontEventsService } from '../services/icloud-storefront-events.service';
import { IcloudRelayPluginOptions } from '../types';

/** POST keeps the mailbox capability out of URLs, referrers and proxy access logs. */
@Controller('storefront-realtime')
export class IcloudMailStreamController {
    private readonly connections = new Map<string, number>();
    constructor(
        private readonly context: RequestContextService,
        private readonly connection: TransactionalConnection,
        private readonly queries: IcloudPublicQueryService,
        private readonly events: IcloudStorefrontEventsService,
        @Optional() @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS) private readonly options?: IcloudRelayPluginOptions,
    ) {}

    @Post('mail-events')
    async stream(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
        res.setHeader('Cache-Control', 'private, no-store, no-transform');
        const input = body as { queryCode?: unknown; cursor?: unknown } | null;
        const ip = req.ip || req.socket?.remoteAddress;
        if (
            !ip ||
            typeof input?.queryCode !== 'string' ||
            !/^(BUY|MSTR)-[A-Z0-9]{3,8}-[A-Z0-9]{3,8}$/i.test(input.queryCode)
        ) {
            res.status(400).json({ error: 'invalid_request' });
            return;
        }
        if ((this.connections.get(ip) ?? 0) >= 8) {
            res.status(429).json({ error: 'too_many_connections' });
            return;
        }
        this.connections.set(ip, (this.connections.get(ip) ?? 0) + 1);
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let expires: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe: (() => unknown) | undefined;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            if (heartbeat) clearInterval(heartbeat);
            if (expires) clearTimeout(expires);
            unsubscribe?.();
            const count = (this.connections.get(ip) ?? 1) - 1;
            if (count > 0) this.connections.set(ip, count);
            else this.connections.delete(ip);
        };
        const end = () => {
            cleanup();
            if (!res.writableEnded) res.end();
        };
        const write = (event: string, data: Record<string, unknown>) => {
            if (closed) return;
            if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) end();
        };
        res.once('close', cleanup);
        res.once('error', end);
        req.once('aborted', end);
        try {
            const ctx = await this.context.create({
                req,
                apiType: 'shop',
                channelOrToken: req.get('vendure-token'),
            });
            const code = input.queryCode;
            const authorize = () => this.queries.authorizeQueryTarget(ctx, code, ip, req.get('user-agent'));
            const target = await authorize();
            if (closed) return;
            if (target.error) {
                res.status(403).json({ error: 'query_access_denied' });
                cleanup();
                return;
            }
            const primary = target.primary ?? target.virtual?.primaryAccount;
            if (
                this.options?.realtimeEnabled === false ||
                primary?.lastSyncError?.includes('不支持实时收信')
            ) {
                res.status(409).json({ error: 'realtime_unavailable' });
                cleanup();
                return;
            }
            if (this.events.isReady === false) {
                res.status(503).json({ error: 'stream_unavailable' });
                cleanup();
                return;
            }
            if (!target.virtual && !target.primary) {
                res.status(403).json({ error: 'query_access_denied' });
                cleanup();
                return;
            }
            const targetId = String(target.virtual?.id ?? target.primary?.id);
            const scope = target.virtual ? { virtualEmailId: targetId } : { primaryAccountId: targetId };
            const matches = (event: MailChange) =>
                target.virtual ? event.virtualEmailId === targetId : event.primaryAccountId === targetId;
            const repo = this.connection.getRepository(ctx, IcloudMailOutbox);
            const queued: MailChange[] = [];
            let ready = false;
            let processing = Promise.resolve();
            let pending = 0;
            const send = (event: MailChange) => {
                if (++pending > 256) {
                    end();
                    return;
                }
                processing = processing
                    .then(async () => {
                        if (closed) return;
                        const access = await authorize();
                        if (closed) return;
                        if (
                            access.error ||
                            String(access.virtual?.id ?? access.primary?.id) !==
                                String(target.virtual?.id ?? target.primary?.id) ||
                            Boolean(access.virtual) !== Boolean(target.virtual)
                        ) {
                            write('access-denied', {});
                            end();
                            return;
                        }
                        if (
                            (access.primary ?? access.virtual?.primaryAccount)?.lastSyncError?.includes(
                                '不支持实时收信',
                            )
                        ) {
                            write('unavailable', {});
                            end();
                            return;
                        }
                        if (event.kind === 'access') {
                            write('reconcile', {});
                            return;
                        }
                        write('mail', { eventId: event.eventId, cursor: event.cursor });
                    })
                    .catch(end)
                    .finally(() => {
                        pending--;
                    });
            };
            unsubscribe = this.events.subscribe(event => {
                if (!event) {
                    end();
                    return;
                }
                if (event.kind !== 'access' && !matches(event)) return;
                if (!ready) {
                    queued.push(event);
                    if (queued.length > 1000) end();
                } else send(event);
            });
            const latest = await repo.findOne({ where: scope, order: { id: 'DESC' } });
            let recovered = false;
            if (typeof input.cursor === 'string' && /^\d{1,20}$/.test(input.cursor)) {
                const missed = await repo.find({
                    where: { ...scope, id: MoreThan(input.cursor) },
                    order: { id: 'ASC' },
                    take: 1,
                });
                recovered = missed.length > 0;
            }
            if (closed) return;
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            // Every connection reconciles once: transaction IDs may commit out of order,
            // and a cursor may predate retained history. Heartbeats never touch the DB.
            write('ready', {
                version: 1,
                cursor: latest ? String(latest.id) : '0',
                reconcile: true,
                recovered,
                heartbeatIntervalMs: 15_000,
            });
            if (closed) return;
            ready = true;
            for (const event of queued) send(event);
            heartbeat = setInterval(() => {
                if (!closed && !res.write(': heartbeat\n\n')) end();
            }, 15_000);
            heartbeat.unref?.();
            const deadline = target.virtual?.codeExpiresAt ?? target.primary?.codeExpiresAt;
            if (deadline) {
                const expire = () => {
                    if (closed) return;
                    const duration = new Date(deadline).getTime() - Date.now();
                    if (duration <= 0) {
                        write('access-denied', {});
                        end();
                    } else expires = setTimeout(expire, Math.min(duration, 2_147_483_647));
                };
                expire();
            }
        } catch {
            if (!res.headersSent) res.status(503).json({ error: 'stream_unavailable' });
            end();
        }
    }
}
