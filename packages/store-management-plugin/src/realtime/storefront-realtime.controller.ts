import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { SessionService } from '@vendure/core';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from '../promotion/storefront-promotion-access.service';

import { StorefrontRealtimePayload, StorefrontRealtimeService } from './storefront-realtime.service';

const HEARTBEAT_INTERVAL_MS = 15_000;

@Controller('storefront-realtime')
export class StorefrontRealtimeController {
    constructor(
        private readonly realtime: StorefrontRealtimeService,
        private readonly storefrontAccess: StorefrontPromotionAccessService,
        private readonly sessionService: SessionService,
    ) {}

    @Get('events')
    async events(
        @Req() req: Request,
        @Res() res: Response,
        @Query('client') clientType?: string,
    ): Promise<void> {
        const token = sessionToken(req);
        const session = token ? await this.sessionService.getSessionFromToken(token) : undefined;
        const storefrontRequest = await this.storefrontAccess.resolveRequest(req);
        if (!storefrontRequest) {
            res.status(404).json({ error: '未找到该域名对应的店铺' });
            return;
        }
        const channelId = String(storefrontRequest.channelId);
        const admin = clientType === 'admin' && hasAdminChannelAccess(session, channelId);

        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        writeSse(res, 'ready', {
            version: 1,
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        });

        const removeClient = this.realtime.addClient({
            channelId,
            userId: session?.user?.id == null ? undefined : String(session.user.id),
            activeOrderId: session?.activeOrderId == null ? undefined : String(session.activeOrderId),
            admin,
            send: payload => writeSse(res, 'invalidate', payload, payload.id),
        });
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), HEARTBEAT_INTERVAL_MS);
        heartbeat.unref?.();
        let closed = false;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            removeClient();
        };
        req.once('close', cleanup);
        res.once('close', cleanup);
    }
}

function writeSse(
    response: Response,
    event: string,
    data: StorefrontRealtimePayload | Record<string, unknown>,
    id?: string,
): void {
    if (id) response.write(`id: ${id}\n`);
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sessionToken(req: Request): string | undefined {
    const cookieToken = (req as Request & { session?: { token?: unknown } }).session?.token;
    if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
    const authorization = req.get('Authorization')?.trim();
    return authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
}

function hasAdminChannelAccess(
    session: Awaited<ReturnType<SessionService['getSessionFromToken']>>,
    channelId: string,
): boolean {
    return Boolean(session?.user?.channelPermissions.some(channel => String(channel.id) === channelId));
}
