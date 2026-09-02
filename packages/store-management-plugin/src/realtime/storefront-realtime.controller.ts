import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { SessionService } from '@vendure/core';
import type { Request, Response } from 'express';

import { StorefrontPromotionAccessService } from '../promotion/storefront-promotion-access.service';

import { StorefrontRealtimePayload, StorefrontRealtimeService } from './storefront-realtime.service';

const HEARTBEAT_INTERVAL_MS = 15_000;
const BACKPRESSURE_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 2;

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

        let closed = false;
        let backpressured = false;
        let backpressureTimeout: ReturnType<typeof setTimeout> | undefined;
        const resources: {
            heartbeat?: ReturnType<typeof setInterval>;
            removeClient?: () => void;
        } = {};
        const onDrain = () => {
            if (closed) return;
            backpressured = false;
            if (backpressureTimeout) clearTimeout(backpressureTimeout);
            backpressureTimeout = undefined;
        };
        const cleanup = (): boolean => {
            if (closed) return false;
            closed = true;
            if (resources.heartbeat) clearInterval(resources.heartbeat);
            if (backpressureTimeout) clearTimeout(backpressureTimeout);
            res.off('drain', onDrain);
            resources.removeClient?.();
            return true;
        };
        const abortResponse = () => {
            if (!cleanup()) return;
            if (!res.destroyed) res.destroy();
        };
        const trackBackpressure = (writeAccepted: boolean) => {
            if (writeAccepted || backpressured || closed) return;
            backpressured = true;
            res.once('drain', onDrain);
            backpressureTimeout = setTimeout(abortResponse, BACKPRESSURE_TIMEOUT_MS);
            backpressureTimeout.unref?.();
        };
        req.once('aborted', abortResponse);
        req.once('close', cleanup);
        res.once('close', cleanup);
        res.once('error', cleanup);

        if (req.aborted) {
            abortResponse();
            return;
        }
        if (!isResponseWritable(res)) {
            cleanup();
            return;
        }
        try {
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            if (closed || !isResponseWritable(res)) {
                cleanup();
                return;
            }
            trackBackpressure(
                writeSse(res, 'ready', {
                    version: 1,
                    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
                }),
            );
        } catch {
            abortResponse();
            return;
        }

        if (closed) return;
        resources.removeClient = this.realtime.addClient({
            channelId,
            userId: session?.user?.id == null ? undefined : String(session.user.id),
            activeOrderId: session?.activeOrderId == null ? undefined : String(session.activeOrderId),
            admin,
            send: payload => {
                if (closed) return;
                if (backpressured) {
                    abortResponse();
                    return;
                }
                if (!isResponseWritable(res)) {
                    cleanup();
                    return;
                }
                try {
                    trackBackpressure(writeSse(res, 'invalidate', payload, payload.id));
                } catch (error) {
                    abortResponse();
                    throw error;
                }
            },
        });
        if (closed) {
            resources.removeClient();
            return;
        }
        resources.heartbeat = setInterval(() => {
            if (!isResponseWritable(res)) {
                cleanup();
                return;
            }
            if (backpressured) return;
            try {
                trackBackpressure(res.write(': heartbeat\n\n'));
            } catch {
                abortResponse();
            }
        }, HEARTBEAT_INTERVAL_MS);
        resources.heartbeat.unref?.();
    }
}

function writeSse(
    response: Response,
    event: string,
    data: StorefrontRealtimePayload | Record<string, unknown>,
    id?: string,
): boolean {
    return response.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isResponseWritable(response: Response): boolean {
    return !response.destroyed && !response.writableEnded;
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
