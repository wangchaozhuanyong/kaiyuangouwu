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
