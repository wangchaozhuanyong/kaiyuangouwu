import { Controller, Get, Req, Res } from '@nestjs/common';
import { Allow, Ctx, Permission, RequestContext, SessionService } from '@vendure/core';
import type { Request, Response } from 'express';

import { type AdminOrderEvent, OrderEventsService } from '../service/order-events.service';

@Controller('admin-order-events')
export class OrderEventsController {
    constructor(
        private readonly events: OrderEventsService,
        private readonly sessions: SessionService,
    ) {}

    @Get()
    @Allow(Permission.ReadOrder)
    stream(@Ctx() ctx: RequestContext, @Req() req: Request, @Res() res: Response): void {
        // The existing global Vendure AuthGuard supplies the session and Channel-scoped permission.
        if (!ctx.session?.user || !ctx.userHasPermissions([Permission.ReadOrder])) {
            res.status(403).end();
            return;
        }
        const sessionToken = ctx.session.token;
        const channelId = String(ctx.channelId);
        let closed = false;
        const resources: {
            remove?: () => unknown;
            heartbeat?: ReturnType<typeof setInterval>;
            expiry?: ReturnType<typeof setTimeout>;
        } = {};
        let pending = Promise.resolve();
        let queued = 0;
        const close = () => {
            if (closed) return;
            closed = true;
            if (resources.heartbeat) clearInterval(resources.heartbeat);
            if (resources.expiry) clearTimeout(resources.expiry);
            resources.remove?.();
            if (!res.writableEnded && !res.destroyed) res.end();
        };
        const write = (frame: string) => {
            if (closed) return;
            // A slow client reconnects and replays from its last received event rather than buffering forever.
            if (res.destroyed || res.writableEnded || !res.write(frame)) close();
        };
        const send = (event: AdminOrderEvent) => {
            if (closed) return;
            if (++queued > 200) {
                close();
                return;
            }
            pending = pending
                .then(async () => {
                    if (closed) return;
                    // Recheck only when delivering an event, so logout/permission revocation cannot leak later orders.
                    const session = await this.sessions.getSessionFromToken(sessionToken);
                    const permission = session?.user?.channelPermissions.find(
                        channel => String(channel.id) === channelId,
                    );
                    if (
                        !session ||
                        session.expires <= new Date() ||
                        !permission?.permissions.some(
                            value => value === Permission.ReadOrder || value === Permission.SuperAdmin,
                        )
                    ) {
                        close();
                        return;
                    }
                    write(`id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
                })
                .catch(close)
                .finally(() => {
                    queued--;
                });
        };
        req.once('aborted', close);
        res.once('close', close);
        res.once('error', close);
        if (req.aborted || res.destroyed) {
            close();
            return;
        }
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const subscription = this.events.subscribe(channelId, req.get('Last-Event-ID'), send, close);
        resources.remove = subscription.remove;
        for (const event of subscription.replay) send(event);
        pending = pending
            .then(() =>
                write(
                    `event: ready\ndata: ${JSON.stringify({ version: 1, cursor: subscription.cursor })}\n\n`,
                ),
            )
            .catch(close);
        // Transport keepalive only: no order/session/database query runs on this interval.
        resources.heartbeat = setInterval(() => {
            try {
                write(': heartbeat\n\n');
            } catch {
                close();
            }
        }, 25000);
        resources.heartbeat.unref?.();
        resources.expiry = setTimeout(
            close,
            Math.max(0, Math.min(2147483647, ctx.session.expires.getTime() - Date.now())),
        );
        resources.expiry.unref?.();
    }
}
