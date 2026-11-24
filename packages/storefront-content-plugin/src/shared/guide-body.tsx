import { type ReactNode } from 'react';

import './guide-body.css';

/**
 * A literal Markdown subset for published guides: headings, paragraphs, lists, tables and rules.
 * Raw HTML is never parsed — every authored string becomes a text node.
 */
export type GuideBodyBlock =
    | { kind: 'heading'; level: 2 | 3; text: string }
    | { kind: 'paragraph'; text: string }
    | { kind: 'list'; ordered: boolean; items: string[] }
    | { kind: 'table'; header: string[]; rows: string[][] }
    | { kind: 'rule' };

const tableRow = /^\s*\|.*\|\s*$/u;
const tableSeparator = /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/u;
const heading = /^(#{1,3})\s+(.*)$/u;
const unorderedItem = /^\s*[-*]\s+(.*)$/u;
const orderedItem = /^\s*\d+[.)]\s+(.*)$/u;
const rule = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;

function tableCells(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/u, '')
        .replace(/\|$/u, '')
        .split('|')
        .map(cell => cell.trim());
}

/** Deterministic parse shared by server rendering, hydration and previews. */
export function guideBodyBlocks(body: string): GuideBodyBlock[] {
    const lines = body.replace(/\r\n?/gu, '\n').split('\n');
    const blocks: GuideBodyBlock[] = [];
    const pushParagraph = (text: string) => {
        const value = text.replace(/^\s*>\s?/u, '').trim();
        if (value) blocks.push({ kind: 'paragraph', text: value });
    };
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index += 1;
            continue;
        }
        if (tableRow.test(line)) {
            const rows: string[][] = [];
            while (index < lines.length && tableRow.test(lines[index])) {
                if (!tableSeparator.test(lines[index])) rows.push(tableCells(lines[index]));
                index += 1;
            }
            const [header, ...rest] = rows;
            if (header?.length) {
                const width = header.length;
                const normalize = (cells: string[]) =>
                    Array.from({ length: width }, (_, cell) => cells[cell] ?? '');
                blocks.push({ kind: 'table', header, rows: rest.map(normalize) });
            }
            continue;
        }
        if (rule.test(line)) {
            blocks.push({ kind: 'rule' });
            index += 1;
            continue;
        }
        const headingMatch = heading.exec(line);
        if (headingMatch) {
            blocks.push({
                kind: 'heading',
                level: headingMatch[1].length >= 3 ? 3 : 2,
                text: headingMatch[2].trim(),
            });
            index += 1;
            continue;
        }
        if (unorderedItem.test(line) || orderedItem.test(line)) {
            const ordered = orderedItem.test(line);
            const items: string[] = [];
            while (index < lines.length) {
                const current = lines[index];
                const match = ordered ? orderedItem.exec(current) : unorderedItem.exec(current);
                if (!match) break;
                items.push(match[1].trim());
                index += 1;
            }
            if (items.length) blocks.push({ kind: 'list', ordered, items });
            continue;
        }
        const paragraph: string[] = [];
        while (index < lines.length) {
            const current = lines[index];
            if (
                !current.trim() ||
                tableRow.test(current) ||
                rule.test(current) ||
                heading.test(current) ||
                unorderedItem.test(current) ||
                orderedItem.test(current)
            )
                break;
            paragraph.push(current);
            index += 1;
        }
        pushParagraph(paragraph.join('\n'));
    }
    return blocks;
}

const inlineToken = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^()\s]+\))/u;

function safeHref(href: string): string | null {
    if (/^\/(?!\/)/u.test(href)) return href;
    if (/^https:\/\//iu.test(href)) return href;
    return null;
}

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let rest = text;
    let position = 0;
    while (rest) {
        const match = inlineToken.exec(rest);
        if (!match) {
            nodes.push(rest);
            break;
        }
        if (match.index > 0) nodes.push(rest.slice(0, match.index));
        const token = match[0];
        const key = `${keyPrefix}-${position++}`;
        if (token.startsWith('**')) {
            nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
        } else {
            const link = /^\[([^\]]+)\]\(([^()\s]+)\)$/u.exec(token);
            const href = link ? safeHref(link[2]) : null;
            nodes.push(
                href && link ? (
                    <a
                        key={key}
                        href={href}
                        {...(/^https:\/\//iu.test(href)
                            ? { target: '_blank', rel: 'noopener noreferrer' }
                            : {})}
                    >
                        {link[1]}
                    </a>
                ) : (
                    token
                ),
            );
        }
        rest = rest.slice(match.index + token.length);
    }
    return nodes;
}

/** Published guide body. Structure only; no authored HTML is executed or injected. */
export function GuideBody({ body }: { body: string }) {
    const blocks = guideBodyBlocks(body);
    return (
        <div className="guide-body">
            {blocks.map((block, index) => {
                const key = `block-${index}`;
                if (block.kind === 'heading')
                    return block.level === 3 ? (
                        <h3 key={key}>{inlineNodes(block.text, key)}</h3>
                    ) : (
                        <h2 key={key}>{inlineNodes(block.text, key)}</h2>
                    );
                if (block.kind === 'paragraph') return <p key={key}>{inlineNodes(block.text, key)}</p>;
                if (block.kind === 'rule')
                    return (
                        <div key={key} className="guide-body-divider" role="separator" aria-hidden="true" />
                    );
                if (block.kind === 'list') {
                    const items = block.items.map((item, itemIndex) => (
                        <li key={`${key}-${itemIndex}`}>{inlineNodes(item, `${key}-${itemIndex}`)}</li>
                    ));
                    return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
                }
                return (
                    <div className="guide-body-table" key={key}>
                        <table>
                            <thead>
                                <tr>
                                    {block.header.map((cell, cellIndex) => (
                                        <th key={`${key}-h-${cellIndex}`} scope="col">
                                            {inlineNodes(cell, `${key}-h-${cellIndex}`)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {block.rows.map((row, rowIndex) => (
                                    <tr key={`${key}-r-${rowIndex}`}>
                                        {row.map((cell, cellIndex) => (
                                            <td key={`${key}-r-${rowIndex}-${cellIndex}`}>
                                                {inlineNodes(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
}
