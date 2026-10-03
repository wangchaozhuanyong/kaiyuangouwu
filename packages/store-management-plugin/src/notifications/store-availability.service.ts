import { Injectable } from '@nestjs/common';
import { LanguageCode, RequestContextService, TransactionalConnection } from '@vendure/core';
import {
    AdminNotificationConfigService,
    AdminNotificationService,
    NotificationSignalService,
} from '@vendure/operations-dashboard-plugin';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { createHash } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';
import { request } from 'node:https';
import { checkServerIdentity, connect } from 'node:tls';

import { trafficPublicIp } from '../traffic/storefront-traffic.service';

export interface StoreProbeResult {
    healthy: boolean;
    certificateEnd: Date;
    certificateValid: boolean;
}
/** Domain comes only from the verified primary-domain registry; DNS is validated and the connection is pinned. */
export async function probeStore(domain: string): Promise<StoreProbeResult> {
    if (
        !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) ||
        !domain.includes('.') ||
        domain.endsWith('.localhost')
    )
        throw new Error('巡检域名无效');
    const addresses = await resolve4(domain);
    if (!addresses.length || addresses.some(candidate => !trafficPublicIp(candidate)))
        throw new Error('巡检目标未通过网络安全校验');
    const address = addresses[0];
    const certificate = await new Promise<{ end: Date; valid: boolean }>((resolve, reject) => {
        const socket = connect({ host: address, port: 443, servername: domain, rejectUnauthorized: false });
        socket.setTimeout(7000, () => socket.destroy(new Error('巡检超时')));
        socket.once('secureConnect', () => {
            const cert = socket.getPeerCertificate();
            resolve({
                end: new Date(cert.valid_to),
                valid: socket.authorized && !checkServerIdentity(domain, cert),
            });
            socket.end();
        });
        socket.once('error', () => reject(new Error('巡检连接失败')));
    });
    if (!Number.isFinite(certificate.end.getTime())) throw new Error('证书监测数据不可用');
    if (!certificate.valid)
        return { healthy: false, certificateEnd: certificate.end, certificateValid: false };
    const healthy = await new Promise<boolean>(resolve => {
        const req = request(
            {
                hostname: address,
                servername: domain,
                port: 443,
                path: '/health',
                method: 'GET',
                headers: { Host: domain },
                timeout: 7000,
            },
            response => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', chunk => {
                    body += chunk;
                    if (body.length > 8192) response.destroy();
                });
                response.on('end', () => {
                    try {
                        resolve(response.statusCode === 200 && JSON.parse(body).status === 'ok');
                    } catch {
                        resolve(false);
                    }
                });
                response.on('error', () => resolve(false));
            },
        );
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(false));
        req.end();
    });
    return { healthy, certificateEnd: certificate.end, certificateValid: certificate.valid };
}
export function certificateThreshold(end: Date, now = new Date()) {
    const days = (end.getTime() - now.getTime()) / 86400000;
    return days <= 0 ? 0 : ([3, 7, 14].find(value => days <= value) ?? null);
}
@Injectable()
export class StoreAvailabilityService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly contexts: RequestContextService,
        private readonly notifications: AdminNotificationService,
        private readonly signals: NotificationSignalService,
        private readonly config: AdminNotificationConfigService,
    ) {}
    async reconcile(now = new Date(), probe = probeStore) {
        const config = await this.config.get();
        if (!config.enabled || !config.notifySecurityEvents) return;
        const domains = await this.connection.rawConnection
            .getRepository(StoreDomain)
            .find({ where: { status: 'ACTIVE', isPrimary: true }, relations: ['channel'] });
        for (const domain of domains) {
            const ctx = await this.contexts.create({
                apiType: 'admin',
                channelOrToken: domain.channel,
                languageCode: LanguageCode.zh_Hans,
            });
            const fingerprint = `store.availability:${domain.channelId}`;
            const monitorFingerprint = `store.monitor:${domain.channelId}`;
            const certificateFingerprint = `store.certificate:${domain.channelId}`;
            const payload = { channelId: String(domain.channelId), adminPath: '/settings/store-domains' };
            let result: StoreProbeResult;
            try {
                result = await probe(domain.domain);
            } catch {
                const identity = createHash('sha256').update(`store-probe:${domain.id}`).digest('hex');
                if ((await this.signals.count(identity, 25 * 60_000)).count >= 2)
                    await this.notifications.upsertIncident(ctx, {
                        eventType: 'system.monitor.unavailable',
                        category: 'SECURITY',
                        severity: 'P1',
                        fingerprint: monitorFingerprint,
                        title: '店铺巡检暂不可用',
                        payload: {
                            ...payload,
                            reason: '巡检未能完成，暂不能区分店铺故障与巡检网络异常；请结合外部巡检核查',
                        },
                    });
                continue;
            }
            await this.signals.reset(createHash('sha256').update(`store-probe:${domain.id}`).digest('hex'));
            await this.notifications.resolveIncident(ctx, monitorFingerprint, {
                reason: '店铺巡检已成功完成',
            });
            if (!result.healthy) {
                const identity = createHash('sha256').update(`store-unhealthy:${domain.id}`).digest('hex');
                if ((await this.signals.count(identity, 25 * 60_000)).count >= 2)
                    await this.notifications.upsertIncident(ctx, {
                        eventType: 'system.store.unavailable',
                        category: 'SECURITY',
                        severity: 'P0',
                        fingerprint,
                        title: '店铺健康接口持续异常',
                        payload: { ...payload, reason: '已连接到实际店铺入口，但健康接口持续未通过检查' },
                    });
            } else {
                await this.signals.reset(
                    createHash('sha256').update(`store-unhealthy:${domain.id}`).digest('hex'),
                );
                await this.notifications.resolveIncident(ctx, fingerprint, {
                    reason: '店铺健康接口恢复正常',
                });
            }
            const threshold = certificateThreshold(result.certificateEnd, now);
            if (!result.certificateValid || threshold === 0)
                await this.notifications.upsertIncident(ctx, {
                    eventType: 'system.certificate.invalid',
                    category: 'SECURITY',
                    severity: 'P0',
                    fingerprint: certificateFingerprint,
                    title: '店铺网站证书失效',
                    payload: { ...payload, reason: '证书已过期或未通过有效性与域名校验' },
                });
            else {
                await this.notifications.resolveIncident(ctx, certificateFingerprint, {
                    reason: '网站证书已恢复有效',
                });
                if (threshold)
                    await this.notifications.enqueueOneOff(ctx, {
                        eventType: 'system.certificate.expiring',
                        category: 'SECURITY',
                        severity: threshold === 3 ? 'P1' : 'P2',
                        silent: true,
                        dedupKey: `certificate-expiry:${domain.id}:${result.certificateEnd.toISOString()}:${threshold}`,
                        title: '店铺网站证书即将到期',
                        payload: {
                            ...payload,
                            remaining: `不足 ${threshold} 天`,
                            endsAt: new Intl.DateTimeFormat('zh-CN', {
                                timeZone: 'Asia/Kuala_Lumpur',
                                dateStyle: 'short',
                                timeStyle: 'short',
                                hour12: false,
                            }).format(result.certificateEnd),
                        },
                    });
            }
        }
    }
}
