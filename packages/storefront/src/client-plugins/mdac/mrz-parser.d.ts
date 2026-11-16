export interface ParsedMrz {
    valid: boolean;
    format: string;
    surname: string;
    givenNames: string;
    documentNumber: string;
    nationality: string;
    issuingCountry: string;
    birthDate: string;
    expirationDate: string;
    sex: string;
}
export function normalizeOcrText(text: string): string;
export function extractMrzLines(text: string): string[];
export function parseMRZ(lines: string[]): ParsedMrz;
