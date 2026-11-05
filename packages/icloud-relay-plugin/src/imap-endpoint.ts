export const DEFAULT_ICLOUD_IMAP_HOST = 'imap.mail.me.com';
export const DEFAULT_ICLOUD_IMAP_PORT = 993;
export const ICLOUD_IMAP_ENDPOINT_ERROR = 'iCloud IMAP 仅支持 imap.mail.me.com:993';

export function isIcloudImapEndpoint(host?: string | null, port?: number | null): boolean {
    return (
        (host?.trim().toLowerCase() || DEFAULT_ICLOUD_IMAP_HOST) === DEFAULT_ICLOUD_IMAP_HOST &&
        (port ?? DEFAULT_ICLOUD_IMAP_PORT) === DEFAULT_ICLOUD_IMAP_PORT
    );
}
