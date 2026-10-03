#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';

import { loadProductionStorefronts } from './production-storefronts.mjs';

const hostReasons = {
    'mysql-unreachable': ['P0', '数据库无法连接'],
    'public-health-failed': ['P0', '店铺公共健康检查失败'],
    'image-generation-health-failed': ['P1', '人工智能后台任务健康检查失败'],
    'backup-missing-or-stale': ['P1', '数据库备份缺失或超过三十六小时'],
    'backup-checksum-invalid': ['P0', '备份完整性校验失败'],
    'restore-drill-missing-or-stale': ['P1', '恢复验证证据缺失或超过九天'],
    'root-disk-high': ['P1', '服务器磁盘使用率达到百分之八十五或无法读取'],
};
export function hostSignals(failures) {
    return Object.entries(hostReasons).map(([key, [severity, reason]]) => ({
        key: `host:${key}`,
        severity,
        reason,
        firing: failures.includes(key),
        samples: key === 'mysql-unreachable' ? 2 : 1,
    }));
}
export function certificateSignal(host, certificate, now = new Date()) {
    const end = new Date(certificate.valid_to);
    if (!Number.isFinite(end.getTime()))
        return {
            key: `tls:${host}`,
            severity: 'P1',
            firing: true,
            monitor: true,
            reason: `${host}：证书有效期暂无法读取`,
            samples: 2,
        };
    const days = (end.getTime() - now.getTime()) / 86400000;
    if (days <= 0 || certificate.authorized === false)
        return {
            key: `tls:${host}`,
            severity: 'P0',
            firing: true,
            reason: `${host}：网站证书已失效或未通过校验`,
            samples: 1,
        };
    const threshold = [3, 7, 14].find(value => days <= value);
    return {
        key: `tls:${host}`,
        severity: threshold === 3 ? 'P1' : 'P2',
        firing: threshold != null,
        oneOff: true,
        revision: `${end.toISOString()}:${threshold ?? 'healthy'}`,
        reason:
            `${host}：网站证书距离到期不足 ${threshold ?? 14} 天，结束时间 ` +
            new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Kuala_Lumpur',
                dateStyle: 'short',
                timeStyle: 'short',
                hour12: false,
            }).format(end),
        samples: 1,
    };
}
export function readCertificate(host) {
    return new Promise((resolve, reject) => {
        const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false });
        socket.setTimeout(7000, () => socket.destroy(new Error('证书巡检超时')));
        socket.once('secureConnect', () => {
            const cert = socket.getPeerCertificate();
            resolve({ valid_to: cert.valid_to, authorized: socket.authorized });
            socket.end();
        });
        socket.once('error', () => reject(new Error('证书巡检连接失败')));
    });
}
export async function publicSignals(config, { fetchImpl = fetch, certificateReader = readCertificate } = {}) {
    const signals = [];
    const targets = [
        ...config.storefronts.map(store => ({ origin: store.origin, path: '/health', json: true })),
        {
            origin: new URL(config.dashboardUrl).origin,
            path: new URL(config.dashboardUrl).pathname,
            json: false,
        },
    ];
    for (const target of targets) {
        const host = new URL(target.origin).hostname;
        try {
            const response = await fetchImpl(new URL(target.path, target.origin), {
                signal: AbortSignal.timeout(7000),
                redirect: 'error',
            });
            const ok = response.status === 200 && (!target.json || (await response.json()).status === 'ok');
            signals.push({
                key: `public:${target.origin}:${target.path}`,
                severity: 'P0',
                firing: !ok,
                reason: `${host}：店铺入口、后台或接口健康检查未通过`,
                samples: 2,
            });
        } catch {
            signals.push({
                key: `public:${target.origin}:${target.path}`,
                severity: 'P0',
                firing: true,
                reason: `${host}：公共入口持续无法访问，需核查网站与网络`,
                samples: 2,
            });
        }
        try {
            signals.push(certificateSignal(host, await certificateReader(host)));
            signals.push({ key: `tls-probe:${host}`, severity: 'P1', firing: false });
        } catch {
            signals.push({
                key: `tls-probe:${host}`,
                severity: 'P1',
                firing: true,
                monitor: true,
                reason: `${host}：证书巡检未能完成，尚未确认网站证书失效`,
                samples: 2,
            });
        }
    }
    return signals;
}
export function externalSignal(result) {
    if (result?.Status === 'Success')
        return {
            key: 'external:inspection',
            severity: 'P1',
            firing: false,
            reason: '外部主机巡检正常',
            samples: 1,
        };
    const confirmed =
        result?.Status === 'Failed' && /Production health monitor failed:/.test(result?.Error ?? '');
    return {
        key: 'external:inspection',
        severity: 'P1',
        firing: true,
        monitor: !confirmed,
        samples: 1,
        reason: confirmed
            ? '主机巡检确认健康检查未通过，请核查后台进程、备份、恢复验证与服务器状态'
            : '外部巡检自身未完成，尚未确认服务器故障；请检查巡检权限、远程管理连接及调度状态',
    };
}
/** Persist only public monitoring metadata. State advances only after a successful send. */
export async function deliverSignals(
    signals,
    state,
    send,
    now = Date.now(),
    { external = false, adminUrl } = {},
) {
    const next = { ...state };
    let sent = 0;
    for (const signal of signals) {
        const old = next[signal.key] ?? { failures: 0, active: false, sentAt: 0, revision: null };
        const entry = { ...old, failures: signal.firing ? old.failures + 1 : 0 };
        const upgraded = signal.severity === 'P0' && old.severity !== 'P0';
        const repeat = now - old.sentAt >= (signal.severity === 'P0' ? 30 : 120) * 60000;
        const needsSend =
            signal.firing &&
            entry.failures >= (signal.samples ?? 1) &&
            (!old.active || upgraded || (signal.oneOff ? old.revision !== signal.revision : repeat));
        const recovered = !signal.firing && old.active;
        if (needsSend || recovered) {
            const title = recovered
                ? '✅ 系统监测恢复'
                : signal.monitor
                  ? '⚠️ 部分监测暂不可用'
                  : signal.severity === 'P0'
                    ? '🚨 系统危急告警'
                    : '⚠️ 系统状态提醒';
            const time = new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Kuala_Lumpur',
                dateStyle: 'short',
                timeStyle: 'short',
                hour12: false,
            }).format(new Date(now));
            const recoveryReason = signal.key.startsWith('tls:')
                ? '证书已恢复正常或完成续期'
                : '本项监测已恢复正常';
            const text =
                `${title}\n对象：平台与相关店铺\n事件：${recovered ? recoveryReason : signal.reason}` +
                `\n时间：${time}\n处理入口：${adminUrl ?? '请打开现有管理后台的系统运维页面'}` +
                `${external ? '\n巡检调度：约每半小时执行，平台调度可能延迟' : ''}\n监测边界：防火墙与主机入侵信号尚未接入，未监测`;
            try {
                await send(text, signal.oneOff && !recovered);
                entry.active = !recovered;
                entry.sentAt = now;
                entry.revision = signal.revision ?? null;
                entry.severity = signal.severity;
                sent++;
            } catch {
                /* Keep active/sent state unchanged: the next run retries. No raw transport error. */
            }
        }
        next[signal.key] = entry;
    }
    return { state: next, sent };
}
async function loadConfig() {
    let config = {
        enabled: process.env.TELEGRAM_EMERGENCY_ENABLED === 'true',
        chatId: process.env.TELEGRAM_OPS_CHAT_ID,
        notifySecurityEvents: true,
        sendResolved: true,
    };
    if (process.env.DB_HOST) {
        let connection;
        try {
            const mysql = await import('mysql2/promise');
            connection = await mysql.createConnection({
                host: process.env.DB_HOST,
                port: Number(process.env.DB_PORT ?? 3306),
                user: process.env.DB_USERNAME,
                password: process.env.DB_PASSWORD,
                database: process.env.DB_NAME,
            });
            const [rows] = await connection.execute(
                'SELECT enabled, chatId, adminBaseUrl, notifySecurityEvents, sendResolved FROM admin_notification_config WHERE `key` = ? LIMIT 1',
                ['telegram-internal'],
            );
            if (rows[0]) config = { ...rows[0], chatId: process.env.TELEGRAM_OPS_CHAT_ID || rows[0].chatId };
        } catch {
            /* Emergency environment fallback remains usable when database is down. */
        } finally {
            await connection?.end();
        }
    }
    return config;
}
async function main() {
    const config = await loadConfig();
    if (
        !config.enabled ||
        !config.notifySecurityEvents ||
        !config.chatId ||
        !process.env.TELEGRAM_BOT_TOKEN
    ) {
        process.stdout.write('中文安全监测通知：接收通道未启用或未配置，本次未发送\n');
        return;
    }
    const hostMode = process.argv.includes('--host');
    const statePath = process.env.VENDURE_NOTIFICATION_STATE_FILE;
    if (!statePath) throw new Error('监测状态路径未配置');
    let state = {};
    try {
        state = JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('监测状态读取失败');
    }
    let signals;
    if (hostMode) {
        signals = hostSignals(process.argv.slice(process.argv.indexOf('--host') + 1));
        const publicConfig = await loadProductionStorefronts();
        // Host checks certificate expiry even when the remote inspection has not run yet.
        for (const origin of [
            ...publicConfig.storefronts.map(store => store.origin),
            new URL(publicConfig.dashboardUrl).origin,
        ]) {
            const host = new URL(origin).hostname;
            try {
                signals.push(certificateSignal(host, await readCertificate(host)));
                signals.push({ key: `tls-probe:${host}`, severity: 'P1', firing: false });
            } catch {
                signals.push({
                    key: `tls-probe:${host}`,
                    severity: 'P1',
                    firing: true,
                    monitor: true,
                    reason: `${host}：证书巡检自身失败，尚未确认网站故障`,
                    samples: 2,
                });
            }
        }
    } else {
        let remote = null;
        try {
            remote = JSON.parse(await readFile(process.env.PRODUCTION_HEALTH_RESULT, 'utf8'));
        } catch {
            /* Missing remote evidence is unavailable, never host outage proof. */
        }
        signals = [...(await publicSignals(await loadProductionStorefronts())), externalSignal(remote)];
    }
    if (!config.sendResolved) signals = signals.filter(signal => signal.firing || !state[signal.key]?.active);
    const result = await deliverSignals(
        signals,
        state,
        async (text, silent) => {
            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    signal: AbortSignal.timeout(10000),
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ chat_id: config.chatId, text, disable_notification: silent }),
                },
            );
            const payload = await response.json();
            if (!response.ok || !payload.ok || !payload.result?.message_id) throw new Error('通知发送失败');
        },
        Date.now(),
        { external: !hostMode, adminUrl: config.adminBaseUrl },
    );
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    await writeFile(`${statePath}.next`, JSON.stringify(result.state), { mode: 0o600 });
    await rename(`${statePath}.next`, statePath);
    process.stdout.write(`中文安全监测通知：已核验 ${signals.length} 项，成功发送 ${result.sent} 条\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main().catch(() => {
        process.stderr.write('中文安全监测通知执行失败，请核查监测配置和状态文件\n');
        process.exitCode = 1;
    });
