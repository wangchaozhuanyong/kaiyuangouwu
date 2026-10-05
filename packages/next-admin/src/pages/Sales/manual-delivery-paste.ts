export interface ManualDeliveryPasteRow {
    account: string;
    key: string;
    note: string;
}

export interface ManualDeliveryPastePreview {
    rows: ManualDeliveryPasteRow[];
    ignoredEmptyLines: number;
    errors: string[];
}

/** Fixed TSV: only the first two tabs delimit fields; subsequent tabs belong to the note. */
export function parseManualDeliveryPaste(text: string, requiredQuantity: number): ManualDeliveryPastePreview {
    const rows: ManualDeliveryPasteRow[] = [];
    const errors: string[] = [];
    let ignoredEmptyLines = 0;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, index) => {
        if (!line.trim()) {
            if (line.includes('\t')) {
                errors.push(`第 ${index + 1} 行缺少交付内容。`);
                return;
            }
            ignoredEmptyLines++;
            return;
        }
        const first = line.indexOf('\t');
        const second = first < 0 ? -1 : line.indexOf('\t', first + 1);
        if (second < 0) {
            errors.push(`第 ${index + 1} 行格式不完整：请用 Tab 分隔账号、密钥/密码、说明三列。`);
            return;
        }
        const row = {
            account: line.slice(0, first).trim(),
            key: line.slice(first + 1, second).trim(),
            note: line.slice(second + 1),
        };
        if (!row.account && !row.key && !row.note.trim()) {
            errors.push(`第 ${index + 1} 行缺少交付内容。`);
            return;
        }
        rows.push(row);
    });
    if (!Number.isInteger(requiredQuantity) || requiredQuantity < 1) {
        errors.push('任务应交付数量无效，请重新读取任务。');
    } else if (rows.length !== requiredQuantity) {
        errors.push(`识别到 ${rows.length} 件，必须恰好提供 ${requiredQuantity} 件成品。`);
    }
    return { rows, ignoredEmptyLines, errors };
}
