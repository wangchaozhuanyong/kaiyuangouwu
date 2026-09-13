import { ParsedMail } from 'mailparser';

export const RECIPIENT_HEADERS = [
    'message-id',
    'to',
    'cc',
    'delivered-to',
    'x-original-to',
    'envelope-to',
    'x-apple-alias-address',
    'received',
];

/** Extract only complete addresses from recipient fields, never sender/body text. */
export function normalizeRecipients(value: unknown): string[] {
    const addresses = new Set<string>();
    const visit = (item: unknown): void => {
        if (typeof item === 'string') {
            let recipientField = item.replace(/"(?:\\.|[^"\\])*"/g, '');
            // Comments and display names are not recipient evidence, even when they contain an address.
            while (/\([^()]*\)/.test(recipientField)) {
                recipientField = recipientField.replace(/\([^()]*\)/g, '');
            }
            if (/[()]/.test(recipientField)) return;
            for (const part of recipientField.split(/[,;]/)) {
                const fields = /[<>]/.test(part)
                    ? [...part.matchAll(/<([^<>]*)>/g)].map(match => match[1])
                    : [part];
                for (const field of fields) {
                    for (const match of field.matchAll(
                        /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/gi,
                    )) {
                        addresses.add(match[0].toLowerCase());
                    }
                }
            }
        } else if (Array.isArray(item)) {
            item.forEach(visit);
        } else if (item && typeof item === 'object') {
            const address = item as { address?: unknown; value?: unknown };
            visit(address.address);
            visit(address.value);
        }
    };
    visit(value);
    return [...addresses];
}

export function extractMailRecipients(mail: Pick<ParsedMail, 'to' | 'cc' | 'headers'>): string[] {
    const recipients: unknown[] = [mail.to, mail.cc];
    for (const header of RECIPIENT_HEADERS.slice(3, -1)) recipients.push(mail.headers.get(header));
    const received = mail.headers.get('received');
    for (const line of Array.isArray(received) ? received : [received]) {
        if (typeof line !== 'string') continue;
        for (const match of line.matchAll(/\bfor\s+(?:<([^>]+)>|([^\s;]+))/gi)) {
            recipients.push(match[1] || match[2]);
        }
    }
    return normalizeRecipients(recipients);
}

export function storedMailRecipients(json: string | null): string[] {
    if (!json) return [];
    try {
        const value: unknown = JSON.parse(json);
        return Array.isArray(value) ? normalizeRecipients(value) : [];
    } catch {
        return [];
    }
}

export function matchMailRecipient<
    T extends { id: string | number; aliasEmail: string; primaryAccountId: string | number },
>(
    recipients: string[],
    virtuals: T[],
    primaryAccountId: string | number,
): { match: T | undefined; ambiguous: boolean } {
    const candidates = new Set(recipients);
    const matches = virtuals.filter(
        v =>
            String(v.primaryAccountId) === String(primaryAccountId) &&
            candidates.has(v.aliasEmail.trim().toLowerCase()),
    );
    return { match: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1 };
}
