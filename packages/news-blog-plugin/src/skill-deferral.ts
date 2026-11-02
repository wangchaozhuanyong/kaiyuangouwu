/** Only a pre-provider public-source read can be retried automatically. */
export class SkillDeferred extends Error {
    constructor(readonly retryAfter: Date) {
        super('公开来源限流，等待请求窗口恢复');
    }
}
