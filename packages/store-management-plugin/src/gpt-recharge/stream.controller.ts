import { Body, Controller, Post, Req, Res, UseFilters } from '@nestjs/common';
import { ForbiddenError, RequestContextService } from '@vendure/core';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from '../promotion/storefront-promotion-access.service';
import { StorefrontClosedHttpFilter } from '../storefront-closed-http.filter';

import { GptRechargeService } from './service';

/** POST keeps task capabilities out of URLs and proxy logs. No store-wide broadcast. */
@Controller('storefront-realtime')
@UseFilters(StorefrontClosedHttpFilter)
export class GptRechargeStreamController {
    private readonly connections = new Map<string, number>();
    constructor(
        private readonly contexts: RequestContextService,
        private readonly access: StorefrontPromotionAccessService,
        private readonly service: GptRechargeService,
    ) {}

    @Post('recharge-events')
    async stream(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
        res.setHeader('Cache-Control', 'private, no-store, no-transform');
        const input = body as { id?: unknown; credential?: unknown } | null;
        const ip = req.ip || req.socket?.remoteAddress;
        if (
            !ip ||
            typeof input?.id !== 'string' ||
            !/^[a-f0-9-]{36}$/i.test(input.id) ||
            typeof input.credential !== 'string' ||
            !/^[a-f0-9]{64}$/i.test(input.credential)
        ) {
            res.status(400).json({ error: 'invalid_request' });
            return;
        }
        if ((this.connections.get(ip) ?? 0) >= 8) {
            res.setHeader('Retry-After', '30');
            res.status(429).json({ error: 'too_many_connections' });
            return;
        }
        this.connections.set(ip, (this.connections.get(ip) ?? 0) + 1);
        const abort = new AbortController();
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let lifetime: ReturnType<typeof setTimeout> | undefined;
        const close = () => {
            if (closed) return;
            closed = true;
            abort.abort();
            clearInterval(heartbeat);
            clearTimeout(lifetime);
            const count = (this.connections.get(ip) ?? 1) - 1;
            if (count) this.connections.set(ip, count);
            else this.connections.delete(ip);
            if (!res.destroyed && res.headersSent) res.end();
        };
        const write = (frame: string) => {
            if (closed) return;
            try {
                if (!res.write(frame)) close();
            } catch {
                close();
            }
        };
        req.once('aborted', close);
        res.once('close', close);
        res.once('error', close);
        try {
            const verified = await this.access.resolveRequest(req);
            if (!verified) throw new ForbiddenError();
            const ctx = await this.contexts.create({
                req,
                apiType: 'shop',
                channelOrToken: verified.ctx.channel,
            });
            if (closed) return;
            await this.service.watchTask(
                ctx,
                input.id,
                input.credential,
                abort.signal,
                () => {
                    if (closed) return;
                    res.status(200).set({
                        'Content-Type': 'text/event-stream; charset=utf-8',
                        'X-Accel-Buffering': 'no',
                    });
                    res.flushHeaders();
                    write('event: ready\ndata: {"heartbeatIntervalMs":15000}\n\n');
                    heartbeat = setInterval(() => write(': heartbeat\n\n'), 15000);
                    lifetime = setTimeout(close, 300000);
                },
                task => {
                    write('event: task\ndata: ' + JSON.stringify(task) + '\n\n');
                    if (['succeeded', 'failed', 'expired'].includes(task.status)) close();
                },
            );
        } catch (error) {
            if (!closed && !res.headersSent)
                res.status(error instanceof ForbiddenError ? 403 : 503).json({
                    error: error instanceof ForbiddenError ? 'task_access_denied' : 'stream_unavailable',
                });
        } finally {
            close();
        }
    }
}
