import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

// Apply on read too: historical sanitized mail must not load sender-owned images or CSS.
// A srcdoc sandbox without scripts still allows network subresources under the parent policy.
export function mailPreviewHtml(html: string | null | undefined): string | null {
    if (!html) return html ?? null;
    return (
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; ' +
        "img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">" +
        html
    );
}

function escapeMailText(text: string): string {
    return text.replace(/[&<>"']/g, character => {
        const entities: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return entities[character];
    });
}

export function mailTextHtml(text: string): string {
    let cursor = 0;
    let content = '';
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'\u0000-\u001f\u007f]+/giu)) {
        const candidate = match[0];
        // html-to-text writes links as [URL]. Delimiters belong to the prose,
        // while balanced brackets in IPv6 hosts and URL paths belong to the URL.
        const counts = new Map<string, number>();
        for (const character of candidate) {
            if ('[](){}'.includes(character)) counts.set(character, (counts.get(character) ?? 0) + 1);
        }
        let end = candidate.length;
        for (;;) {
            const closer = candidate[end - 1];
            // Common sentence punctuation follows a link rather than its signed parameters.
            if (/[.,;!?。，；！？]/u.test(closer ?? '')) {
                end--;
                continue;
            }
            const opener = ({ ']': '[', ')': '(', '}': '{' } as Record<string, string>)[closer];
            if (!opener || (counts.get(closer) ?? 0) <= (counts.get(opener) ?? 0)) break;
            counts.set(closer, (counts.get(closer) ?? 0) - 1);
            end--;
        }
        const address = candidate.slice(0, end);
        const start = match.index;
        content += escapeMailText(text.slice(cursor, start));
        try {
            const url = new URL(address);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported mail link');
            const escaped = escapeMailText(address);
            content += `<a href="${escaped}" target="_blank" rel="noopener noreferrer nofollow">${escaped}</a>`;
        } catch {
            content += escapeMailText(address);
        }
        cursor = start + address.length;
    }
    return `<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${content}${escapeMailText(text.slice(cursor))}</pre>`;
}

@Injectable()
export class IcloudMailSanitizerService {
    sanitize(html: string | null | undefined): string {
        if (!html) {
            return '';
        }

        return sanitizeHtml(html, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                'img',
                'style',
                'span',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'center',
                'hr',
                'pre',
                'code',
                'table',
                'thead',
                'tbody',
                'tfoot',
                'tr',
                'th',
                'td',
            ]),
            allowedAttributes: {
                ...sanitizeHtml.defaults.allowedAttributes,
                '*': ['style', 'class', 'align', 'valign', 'dir', 'width', 'height', 'color'],
                a: ['href', 'name', 'target', 'rel'],
                img: ['src', 'alt', 'title', 'width', 'height', 'style'],
                table: ['cellpadding', 'cellspacing', 'border', 'width', 'height', 'style'],
            },
            transformTags: {
                a: (tagName, attribs) => {
                    return {
                        tagName: 'a',
                        attribs: {
                            ...attribs,
                            target: '_blank',
                            rel: 'noopener noreferrer nofollow',
                        },
                    };
                },
            },
            disallowedTagsMode: 'discard',
        });
    }
}
