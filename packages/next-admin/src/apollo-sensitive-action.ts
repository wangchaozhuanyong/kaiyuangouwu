import { ApolloLink, Observable } from '@apollo/client';

export const SENSITIVE_ACTION_PASSWORD_HEADER = 'x-vendure-sensitive-action-password';
export const SENSITIVE_ACTION_PASSWORD_REQUIRED = 'SENSITIVE_ACTION_PASSWORD_REQUIRED';

export interface SensitiveActionPasswordPromptRequest {
    operationName?: string;
}

export type SensitiveActionPasswordPrompt = (
    request: SensitiveActionPasswordPromptRequest,
) => Promise<string | null>;

let activePasswordPrompt: SensitiveActionPasswordPrompt | undefined;
let promptQueue: Promise<void> = Promise.resolve();

export class SensitiveActionCancelledError extends Error {
    readonly sensitiveActionCancelled = true;

    constructor() {
        super('操作已取消');
        this.name = 'SensitiveActionCancelledError';
    }
}

export function isSensitiveActionCancelledError(error: unknown) {
    return (
        error instanceof SensitiveActionCancelledError ||
        (typeof error === 'object' &&
            error !== null &&
            'sensitiveActionCancelled' in error &&
            error.sensitiveActionCancelled === true)
    );
}

export function registerSensitiveActionPasswordPrompt(prompt: SensitiveActionPasswordPrompt) {
    activePasswordPrompt = prompt;
    return () => {
        if (activePasswordPrompt === prompt) activePasswordPrompt = undefined;
    };
}

async function requestSensitiveActionPassword(request: SensitiveActionPasswordPromptRequest) {
    let resolveQueued: (() => void) | undefined;
    const previousPrompt = promptQueue;
    promptQueue = new Promise<void>(resolve => {
        resolveQueued = resolve;
    });

    await previousPrompt;
    try {
        if (!activePasswordPrompt) {
            throw new Error('密码验证界面尚未就绪，请刷新页面后重试');
        }
        return await activePasswordPrompt(request);
    } finally {
        resolveQueued?.();
    }
}

function requiresSensitiveActionPassword(result: ApolloLink.Result) {
    const graphqlResult = result as {
        errors?: ReadonlyArray<{ extensions?: Readonly<Record<string, unknown>> }>;
    };
    return graphqlResult.errors?.some(error => error.extensions?.code === SENSITIVE_ACTION_PASSWORD_REQUIRED);
}

/**
 * 后端是敏感操作清单的唯一事实源。缺少密码时，先拦截后端的结构化挑战，
 * 再由全局确认框收集一次密码并原样重试当前 mutation。
 */
export const sensitiveActionPasswordLink = new ApolloLink(
    (operation, forward) =>
        new Observable(observer => {
            let subscription: { unsubscribe: () => void } | undefined;
            let disposed = false;
            let waitingForPassword = false;

            const execute = (hasRetried: boolean) => {
                subscription = forward(operation).subscribe({
                    next: result => {
                        if (hasRetried || !requiresSensitiveActionPassword(result)) {
                            observer.next(result);
                            return;
                        }

                        waitingForPassword = true;
                        void requestSensitiveActionPassword({ operationName: operation.operationName })
                            .then(password => {
                                if (disposed) return;
                                waitingForPassword = false;
                                if (!password) {
                                    observer.error(new SensitiveActionCancelledError());
                                    return;
                                }

                                operation.setContext(previousContext => ({
                                    ...previousContext,
                                    headers: {
                                        ...(previousContext.headers as Record<string, string> | undefined),
                                        [SENSITIVE_ACTION_PASSWORD_HEADER]: password,
                                    },
                                }));
                                execute(true);
                            })
                            .catch(error => {
                                if (!disposed) observer.error(error);
                            });
                    },
                    error: error => observer.error(error),
                    complete: () => {
                        if (!waitingForPassword) observer.complete();
                    },
                });
            };

            execute(false);
            return () => {
                disposed = true;
                subscription?.unsubscribe();
            };
        }),
);

export const sensitiveActionContext = (currentPassword: string) => ({
    headers: {
        [SENSITIVE_ACTION_PASSWORD_HEADER]: currentPassword,
    },
});
