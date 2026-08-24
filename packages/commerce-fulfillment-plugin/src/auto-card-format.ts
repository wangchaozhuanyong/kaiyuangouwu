import {
    AUTO_CARD_MAX_DELIMITER_LENGTH,
    AUTO_CARD_MAX_FIELDS,
    AUTO_CARD_MAX_IMPORT_LINES,
    AUTO_CARD_MAX_LINE_LENGTH,
} from './auto-card.constants';

const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/u;

export interface AutoCardFieldDefinition {
    key: string;
    label: string;
    labelEn: string;
    secret: boolean;
}

export interface AutoCardParsedRow {
    lineNumber: number;
    values: Record<string, string>;
}

export interface AutoCardParseError {
    lineNumber: number;
    message: string;
}

export interface AutoCardParseResult {
    rows: AutoCardParsedRow[];
    errors: AutoCardParseError[];
}

export function normalizeAutoCardDelimiter(value: string): string {
    const delimiter = value === '\\t' || value.toUpperCase() === 'TAB' ? '\t' : value;
    if (!delimiter || delimiter.includes('\n') || delimiter.includes('\r')) {
        throw new Error('分隔符不能为空或包含换行符');
    }
    if (delimiter.length > AUTO_CARD_MAX_DELIMITER_LENGTH) {
        throw new Error(`分隔符不能超过 ${AUTO_CARD_MAX_DELIMITER_LENGTH} 个字符`);
    }
    return delimiter;
}

export function validateAutoCardFields(fields: AutoCardFieldDefinition[]): AutoCardFieldDefinition[] {
    if (!Array.isArray(fields) || fields.length < 1 || fields.length > AUTO_CARD_MAX_FIELDS) {
        throw new Error(`发卡字段数量必须为 1 至 ${AUTO_CARD_MAX_FIELDS} 个`);
    }
    const keys = new Set<string>();
    const labels = new Set<string>();
    const englishLabels = new Set<string>();
    return fields.map(field => {
        const key = field.key?.trim();
        const label = field.label?.trim();
        const labelEn = field.labelEn?.trim() || defaultEnglishAutoCardFieldLabel(key, label);
        if (!FIELD_KEY_PATTERN.test(key)) {
            throw new Error(`字段键“${key || '空'}”格式无效`);
        }
        if (!label || label.length > 40) {
            throw new Error('中文字段名称不能为空且不能超过 40 个字符');
        }
        if (!labelEn || labelEn.length > 40) {
            throw new Error('英文字段名称不能为空且不能超过 40 个字符');
        }
        if (keys.has(key) || labels.has(label) || englishLabels.has(labelEn.toLowerCase())) {
            throw new Error(`发卡字段“${label}”重复`);
        }
        keys.add(key);
        labels.add(label);
        englishLabels.add(labelEn.toLowerCase());
        return { key, label, labelEn, secret: Boolean(field.secret) };
    });
}

export function autoCardFieldLabel(field: AutoCardFieldDefinition, isChinese: boolean): string {
    return isChinese ? field.label : field.labelEn;
}

function defaultEnglishAutoCardFieldLabel(key: string, label: string): string {
    const knownLabels: Record<string, string> = {
        account: 'Account',
        username: 'Username',
        password: 'Password',
        email: 'Email',
        emailPassword: 'Email password',
        phone: 'Phone',
        twoFactor: '2FA code',
        twoFactorCode: '2FA code',
        otp: 'OTP code',
        backupCode: 'Backup code',
    };
    if (knownLabels[key]) return knownLabels[key];
    if (label && !/[\p{Script=Han}]/u.test(label)) return label;
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/^./, character => character.toUpperCase());
}

export function parseAutoCardRows(
    rawText: string,
    fieldsInput: AutoCardFieldDefinition[],
    delimiterInput: string,
): AutoCardParseResult {
    const fields = validateAutoCardFields(fieldsInput);
    const delimiter = normalizeAutoCardDelimiter(delimiterInput);
    const lines = rawText.replace(/\r\n?/gu, '\n').split('\n');
    if (lines.length > AUTO_CARD_MAX_IMPORT_LINES) {
        throw new Error(`一次最多导入 ${AUTO_CARD_MAX_IMPORT_LINES} 行`);
    }
    const rows: AutoCardParsedRow[] = [];
    const errors: AutoCardParseError[] = [];
    for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index];
        const lineNumber = index + 1;
        if (!rawLine.trim()) {
            continue;
        }
        if (rawLine.length > AUTO_CARD_MAX_LINE_LENGTH) {
            errors.push({ lineNumber, message: `单行不能超过 ${AUTO_CARD_MAX_LINE_LENGTH} 个字符` });
            continue;
        }
        const columns = rawLine.split(delimiter).map(value => value.trim());
        if (columns.length !== fields.length) {
            errors.push({
                lineNumber,
                message: `预期 ${fields.length} 个字段，实际解析到 ${columns.length} 个`,
            });
            continue;
        }
        const emptyField = fields.find((_, fieldIndex) => !columns[fieldIndex]);
        if (emptyField) {
            errors.push({ lineNumber, message: `字段“${emptyField.label}”不能为空` });
            continue;
        }
        rows.push({
            lineNumber,
            values: Object.fromEntries(fields.map((field, fieldIndex) => [field.key, columns[fieldIndex]])),
        });
    }
    if (!rows.length && !errors.length) {
        errors.push({ lineNumber: 1, message: '请粘贴至少一行发卡数据' });
    }
    return { rows, errors };
}

export function parseAutoCardFieldsJson(value: string): AutoCardFieldDefinition[] {
    try {
        return validateAutoCardFields(JSON.parse(value) as AutoCardFieldDefinition[]);
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : '发卡字段配置无效');
    }
}

export function maskAutoCardValues(
    values: Record<string, string>,
    fields: AutoCardFieldDefinition[],
): Array<AutoCardFieldDefinition & { value: string }> {
    return fields.map(field => ({
        ...field,
        value: field.secret ? maskSecret(values[field.key] ?? '') : maskIdentifier(values[field.key] ?? ''),
    }));
}

function maskSecret(value: string): string {
    if (!value) return '';
    return '•'.repeat(Math.min(10, Math.max(6, Array.from(value).length)));
}

function maskIdentifier(value: string): string {
    if (value.length <= 4) return `${value.slice(0, 1)}***`;
    const at = value.indexOf('@');
    if (at > 1) {
        return `${value.slice(0, 2)}***${value.slice(at)}`;
    }
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
