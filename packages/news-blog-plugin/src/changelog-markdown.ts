interface ReleaseSection {
    anchor: string;
    date: string;
    introduction: string[];
    parts: string[][];
}

const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
];

function plainMarkdown(value: string): string {
    return value
        .replace(/^\s*(?:`{3,}|~{3,}).*$/gmu, '')
        .replace(/!\[[^\]\n]*\]\([^\n)]*\)/gu, '')
        .replace(/\[([^\]\n]+)\]\([^\n)]*\)/gu, '$1')
        .replace(/`+|\*\*|__/gu, '')
        .replace(/^\s*[*-]\s+/gmu, '')
        .replace(/\\([\\`*_{}\[\]()#+.!-])/gu, '$1')
        .trim();
}

/** Official dated Markdown only; nested details and code examples cannot become separate releases. */
export function markdownReleaseEntries(
    markdown: string,
): Array<{ anchor: string; date: string; body: string }> {
    const entries: Array<{ anchor: string; date: string; body: string }> = [];
    let section: ReleaseSection | undefined;
    let fence: string | undefined;
    const append = (line: string) => {
        if (!section) return;
        (section.parts.at(-1) ?? section.introduction).push(line);
    };
    const flush = () => {
        if (!section) return;
        for (const part of section.parts.length ? section.parts : [section.introduction]) {
            const body = plainMarkdown(part.join('\n'));
            if (body) entries.push({ anchor: section.anchor, date: section.date, body });
        }
    };
    for (const line of markdown.replace(/\r\n?/gu, '\n').split('\n')) {
        const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
        if (fence) {
            if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = undefined;
            append(line);
            continue;
        }
        if (marker) {
            fence = marker;
            append(line);
            continue;
        }
        if (/^##\s/u.test(line)) {
            flush();
            section = undefined;
            const date =
                /^##\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})(?:\s+\{%\s*id="([\w.-]+)"\s*%\})?\s*$/u.exec(
                    line,
                );
            if (!date) continue;
            const month = months.indexOf(date[1].toLowerCase());
            if (month < 0) continue;
            const parsed = new Date(Number(date[3]), month, Number(date[2]));
            if (parsed.getMonth() !== month || parsed.getDate() !== Number(date[2])) continue;
            const published = parsed.toISOString();
            section = {
                anchor: date[4] ?? published.slice(0, 10),
                date: published,
                introduction: [],
                parts: [],
            };
        } else if (section && /^[*-]\s+/u.test(line)) {
            section.parts.push([line.replace(/^[*-]\s+/u, '')]);
        } else append(line);
    }
    flush();
    return entries;
}
