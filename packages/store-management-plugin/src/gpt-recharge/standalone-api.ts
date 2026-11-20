import { json, type Request, type RequestHandler } from 'express';

const taskFields =
    'id credential plan status stage updatedAt accountEmail progress { attempt execution version changedAt retryAt milestones { key state at } }';
const codeFields = `plan status reason task { ${taskFields} }`;

const operations = {
    config: { keys: [], document: 'query GptRechargeConfig { gptRechargeConfig { enabled maintenance } }' },
    verify: {
        keys: ['code'],
        document: `mutation VerifyGptRechargeCode($code: String!) { verifyGptRechargeCode(code: $code) { ${codeFields} } }`,
    },
    query: {
        keys: ['code'],
        document: `mutation QueryGptRechargeCode($code: String!) { queryGptRechargeCode(code: $code) { ${codeFields} } }`,
    },
    authorize: {
        keys: ['code', 'requestKey'],
        document: `mutation StartGptRechargeAuthorization($code: String!, $requestKey: String!) {
            startGptRechargeAuthorization(code: $code, requestKey: $requestKey) {
                authorizationUrl task { ${taskFields} }
            }
        }`,
    },
    task: {
        keys: ['id', 'credential'],
        document: `query GptRechargeTask($id: ID!, $credential: String!) { gptRechargeTask(id: $id, credential: $credential) { ${taskFields} } }`,
    },
    challenge: {
        keys: ['action', 'target'],
        document: `mutation CreateShopAbuseChallenge($action: String!, $target: String!) {
            createShopAbuseChallenge(action: $action, target: $target) { id imageDataUrl expiresAt }
        }`,
    },
    events: { keys: ['id', 'credential'], document: '' },
} satisfies Record<string, { keys: string[]; document: string }>;

const standaloneRequests = new WeakSet<Request>();

export function isStandaloneRechargeRequest(request: Request | undefined): boolean {
    return request !== undefined && standaloneRequests.has(request);
}

const prefix = '/api/recharge/';
const readJson = json({ limit: '8kb', inflate: false });

/** Dispatch fixed anonymous operations through the normal shop middleware, resolvers and abuse guards. */
export function standaloneRechargeApi(shopApiPath: string): RequestHandler {
    return (req, res, next) => {
        if (!req.url.startsWith(prefix)) return next();
        res.setHeader('Cache-Control', 'no-store');
        const name = req.url.slice(prefix.length);
        if (!Object.prototype.hasOwnProperty.call(operations, name)) {
            res.sendStatus(404);
            return;
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            res.sendStatus(405);
            return;
        }
        if (!req.is('application/json')) {
            res.sendStatus(415);
            return;
        }
        const operation = operations[name as keyof typeof operations];
        readJson(req, res, error => {
            const variables: unknown = req.body;
            const values = variables as Record<string, unknown>;
            if (
                error ||
                !variables ||
                typeof variables !== 'object' ||
                Array.isArray(variables) ||
                Object.keys(variables).length !== operation.keys.length ||
                !operation.keys.every(key => typeof values[key] === 'string') ||
                (name === 'challenge' &&
                    values.action !== 'RECHARGE_CODE' &&
                    values.action !== 'RECHARGE_SUBMIT')
            ) {
                res.status(400).json({ errors: [{ message: 'Invalid recharge request' }] });
                return;
            }
            standaloneRequests.add(req);
            if (name !== 'events') req.body = { query: operation.document, variables };
            req.url = name === 'events' ? '/storefront-realtime/recharge-events' : '/' + shopApiPath;
            req.originalUrl = req.url;
            next();
        });
    };
}
