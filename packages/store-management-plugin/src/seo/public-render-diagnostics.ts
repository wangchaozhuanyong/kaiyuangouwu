import { ServiceUnavailableException } from '@nestjs/common';

export type PublicDocumentStage =
    'read-page' | 'resolve-seo' | 'required-content' | 'render-html' | 'verify-publication' | 'resolved-seo';

export type PublicHtmlRenderStage =
    | 'artifact-root'
    | 'renderer-load'
    | 'template-read'
    | 'route-styles'
    | 'body-render'
    | 'html-assemble'
    | 'html-cache';

export class PublicHtmlRenderError extends ServiceUnavailableException {
    constructor(
        readonly renderStage: PublicHtmlRenderStage,
        cause: unknown,
    ) {
        super('Public storefront rendering is temporarily unavailable', { cause });
    }
}

const reasons = new Map([
    ['Public data is temporarily unavailable', 'public-cache-unavailable'],
    ['Public content is unavailable', 'required-content-unavailable'],
    ['Public access changed; retry the document', 'public-access-changed'],
    ['Public page changed; retry the document', 'public-page-changed'],
    ['Public authority unavailable during rendering', 'public-authority-unavailable'],
    ['Public language content changed during rendering', 'public-language-changed'],
    ['Public authority changed during rendering', 'public-authority-changed'],
    ['Public SEO resolution is unavailable', 'public-seo-unavailable'],
    ['Public storefront rendering is temporarily unavailable', 'public-html-render-failed'],
    ['Public renderer produced empty HTML', 'empty-rendered-html'],
    ['Missing public route stylesheet', 'missing-route-stylesheet'],
    ['Missing public SEO resolution', 'missing-seo'],
]);
const errorNames = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'ServiceUnavailableException',
    'QueryFailedError',
]);
const errorCodes = new Set([
    'ENOENT',
    'EACCES',
    'EIO',
    'MODULE_NOT_FOUND',
    'ERR_REQUIRE_ESM',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
    'ER_BAD_FIELD_ERROR',
    'ER_NO_SUCH_TABLE',
]);

/** Log only fixed categories and relative code locations, never exception text, SQL or request data. */
export function publicRenderFailureDetails(error: ServiceUnavailableException) {
    const source: unknown = error instanceof PublicHtmlRenderError ? error.cause : error;
    const code = source instanceof Error && 'code' in source ? source.code : undefined;
    const frames =
        source instanceof Error
            ? (source.stack ?? '')
                  .split('\n')
                  .slice(1)
                  .flatMap(line => {
                      const match =
                          /\/((?:packages\/[a-z0-9-]+\/(?:src|dist)|\.server)\/[a-zA-Z0-9_./-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)\)?$/u.exec(
                              line,
                          );
                      return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
                  })
                  .slice(0, 5)
            : [];
    return {
        reason: reasons.get(error.message) ?? 'unclassified-service-unavailable',
        causeReason: source instanceof Error ? reasons.get(source.message) : undefined,
        renderStage: error instanceof PublicHtmlRenderError ? error.renderStage : undefined,
        errorName: source instanceof Error && errorNames.has(source.name) ? source.name : 'UnknownError',
        errorCode: typeof code === 'string' && errorCodes.has(code) ? code : undefined,
        frames,
    };
}
