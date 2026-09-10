export const ICLOUD_RELAY_PLUGIN_OPTIONS = Symbol('ICLOUD_RELAY_PLUGIN_OPTIONS');
export const loggerCtx = 'IcloudRelayPlugin';

export const DEFAULT_ICLOUD_IMAP_HOST = 'imap.mail.me.com';
export const DEFAULT_ICLOUD_IMAP_PORT = 993;
export const DEFAULT_CODE_RESET_INTERVAL_DAYS = 30;

export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const RATE_LIMIT_MAX_ATTEMPTS = 10; // 10 queries per minute per IP
export const RATE_LIMIT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout on 5 consecutive invalid codes
export const RATE_LIMIT_MAX_FAILED_ATTEMPTS = 5;
