/** Only a pre-provider public-source read can be retried automatically. */
export class SkillDeferred extends Error {
    constructor(readonly retryAfter: Date) {
        super('公开来源限流，等待请求窗口恢复');
    }
}
/** A network interruption or temporary HTTP failure, rather than invalid/untrusted source evidence. */
export class SourceTransientError extends Error {
    constructor() {
        super('公开来源暂时不可用');
    }
}
