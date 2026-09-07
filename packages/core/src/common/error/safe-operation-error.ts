import { RequestContext } from '../../api/common/request-context';
import { Logger } from '../../config/logger/vendure-logger';

/**
 * Logs the technical cause server-side while returning only a localized, actionable
 * business explanation to API consumers.
 */
export function safeOperationErrorMessage(
    ctx: RequestContext,
    error: unknown,
    messageKey: string,
    variables: Record<string, string | number>,
    logContext: string,
) {
    const stack = error instanceof Error ? error.stack : undefined;
    Logger.error(logContext, undefined, stack);
    return ctx.translate(messageKey, variables);
}
