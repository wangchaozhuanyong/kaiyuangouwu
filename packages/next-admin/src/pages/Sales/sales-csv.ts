/** Quote delimiters and neutralize spreadsheet formulas in untrusted text. */
export function csvCell(value: string): string {
    const text = /^[\s\u0000-\u001f\u007f]*[=+\-@]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
    return `"${text.replace(/"/gu, '""')}"`;
}
