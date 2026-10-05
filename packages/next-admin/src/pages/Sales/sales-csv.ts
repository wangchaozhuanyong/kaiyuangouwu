/** Quote delimiters and neutralize spreadsheet formulas in untrusted text. */
export function csvCell(value: string): string {
    let offset = 0;
    while (offset < value.length) {
        const code = value.charCodeAt(offset);
        if (code > 31 && code !== 127 && !/\s/u.test(value[offset])) break;
        offset++;
    }
    const firstCode = value.charCodeAt(0);
    const unsafe = [9, 10, 13].includes(firstCode) || /^[=+\-@]/u.test(value.slice(offset));
    const text = unsafe ? `'${value}` : value;
    return `"${text.replace(/"/gu, '""')}"`;
}
