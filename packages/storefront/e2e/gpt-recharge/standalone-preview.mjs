import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// This preview only serves the standalone build and synthetic responses on loopback.
const dist = new URL('../../dist-recharge-tool/', import.meta.url);
const port = Number(process.env.RECHARGE_PREVIEW_PORT || 5198);
const plans = new Map([
    ['DEMO-PLUS', 'plus'],
    ['DEMO-500', 'pro500'],
    ['RA-' + 'A'.repeat(32), 'pro500'],
]);
const ready = { enabled: true, maintenance: false };
const authorizationUrl = 'https://authorization.example.test/recharge/authorize#fixture';
const partnerTask = fixtureTask('partner', 'pro500', 'awaiting_authorization');
const ordinaryTask = fixtureTask('ordinary', 'pro500', 'succeeded');
const plusTask = fixtureTask('plus', 'plus', 'succeeded');
const tasks = [partnerTask, ordinaryTask, plusTask];

function fixtureTask(kind, plan, status) {
    return {
        id: 'preview-' + kind,
        credential: 'preview-only-' + kind,
        plan,
        status,
        stage: status,
        updatedAt: '2026-11-20T09:00:00.000Z',
    };
}

function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
}

function reject(res) {
    sendJson(res, 200, {
        errors: [{ message: '此为本地演示，请使用演示兑换码。', extensions: { code: 'USER_INPUT_ERROR' } }],
    });
}

async function fixtureApi(req, res, operation) {
    if (req.method !== 'POST') return sendJson(res, 405, {});
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8192) return sendJson(res, 413, {});
    }
    let variables;
    try {
        variables = JSON.parse(raw || '{}');
    } catch {
        return sendJson(res, 400, {});
    }
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
        return sendJson(res, 400, {});
    }
    const { code, id, credential } = variables;
    const plan = plans.get(code);
    const data = (field, value) => sendJson(res, 200, { data: { [field]: value } });
    switch (operation) {
        case 'config':
            return data('gptRechargeConfig', ready);
        case 'verify':
            return plan ? data('verifyGptRechargeCode', { plan, status: 'available' }) : reject(res);
        case 'query': {
            if (!plan) return reject(res);
            const task = code.startsWith('RA-') ? partnerTask : plan === 'plus' ? plusTask : ordinaryTask;
            return data('queryGptRechargeCode', {
                plan,
                status: task === partnerTask ? 'reserved' : 'used',
                task,
            });
        }
        case 'authorize':
            if (!plan || !code.startsWith('RA-') || !variables.requestKey) return reject(res);
            return data('startGptRechargeAuthorization', { authorizationUrl, task: partnerTask });
        case 'task':
        case 'events': {
            const task = tasks.find(item => item.id === id && item.credential === credential);
            if (!task) return sendJson(res, 403, {});
            if (operation === 'task') return data('gptRechargeTask', task);
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
            res.write('event: ready\ndata: {}\n\n');
            res.write('event: task\ndata: ' + JSON.stringify(task) + '\n\n');
            if (task.status === 'succeeded') return res.end();
            const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 10000);
            res.once('close', () => clearInterval(heartbeat));
            return;
        }
        case 'challenge': {
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="6" y="26">ABC234</text></svg>';
            return data('createShopAbuseChallenge', {
                id: '1'.repeat(48),
                imageDataUrl: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
                expiresAt: new Date(Date.now() + 120000).toISOString(),
            });
        }
        default:
            return sendJson(res, 404, {});
    }
}

const types = new Map([
    ['html', 'text/html; charset=utf-8'],
    ['js', 'text/javascript; charset=utf-8'],
    ['css', 'text/css; charset=utf-8'],
    ['svg', 'image/svg+xml'],
]);
await readFile(new URL('index.html', dist));
const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Recharge-Preview', 'synthetic-local');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const url = new URL(req.url, 'http://localhost');
        if (
            !['recharge.localhost', '127.0.0.1', 'localhost'].includes((req.headers.host || '').split(':')[0])
        ) {
            return sendJson(res, 404, {});
        }
        const api =
            /^(?:\/p\/preview-partner)?\/api\/recharge\/(config|verify|query|authorize|task|challenge|events)$/.exec(
                url.pathname,
            );
        if (api) return await fixtureApi(req, res, api[1]);
        const asset = /^\/assets\/([A-Za-z0-9._-]+\.(?:css|js)|daylight-dial-[A-Za-z0-9_-]+\.svg)$/.exec(
            url.pathname,
        );
        const page = ['/', '/p/preview-partner', '/p/preview-partner/'].includes(url.pathname);
        if (!page && !asset) return sendJson(res, 404, {});
        if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, {});
        const filename = asset ? 'assets/' + asset[1] : 'index.html';
        const bytes = await readFile(new URL(filename, dist));
        res.writeHead(200, { 'Content-Type': types.get(filename.split('.').at(-1)) });
        res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
        if (!res.headersSent) sendJson(res, error.code === 'ENOENT' ? 404 : 500, {});
        else res.end();
    }
});
server.listen(port, '127.0.0.1', () => {
    process.stdout.write('Synthetic recharge preview on http://recharge.localhost:' + port + '/\n');
    process.stdout.write('Serving ' + fileURLToPath(dist) + '\n');
});
