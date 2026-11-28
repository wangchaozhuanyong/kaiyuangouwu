import type { ShopApi } from '../../api';

import { dateForOfficial, type Fields } from './model';

export type MdacSubmissionStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'MANUAL';

export interface MdacSubmissionView {
    id: string;
    status: MdacSubmissionStatus;
    referenceNo: string | null;
    pin: string | null;
    attempts: number;
    lastError: string | null;
    submittedAt: string | null;
    receiptAvailable: boolean;
    waitingForWindow: boolean;
    travelerName: string;
    arrivalDate: string;
}

export interface MdacSubmissionReceipt {
    fileName: string;
    mimeType: string;
    base64: string;
}

export interface MdacSubmissionService {
    create: (input: Record<string, string>) => Promise<MdacSubmissionView>;
    status: (id: string, signal?: AbortSignal) => Promise<MdacSubmissionView | null>;
    receipt: (id: string, signal?: AbortSignal) => Promise<MdacSubmissionReceipt | null>;
}

const viewFields = `id status referenceNo pin attempts lastError submittedAt receiptAvailable
    waitingForWindow travelerName arrivalDate`;

/** Converts one reviewed traveller into the exact field set the MDAC form posts. */
export function officialSubmissionInput(person: Fields, shared: Fields): Record<string, string> {
    return {
        name: person.name ?? '',
        passNo: person.passNo ?? '',
        nationality: person.nationality ?? '',
        pob: person.pob ?? '',
        dob: dateForOfficial(person.dob ?? ''),
        sex: person.sex ?? '',
        passExpDte: dateForOfficial(person.passExpDte ?? ''),
        email: shared.email ?? '',
        region: shared.region ?? '',
        mobile: shared.mobile ?? '',
        arrDt: dateForOfficial(shared.arrDt ?? ''),
        depDt: dateForOfficial(shared.depDt ?? ''),
        vesselNm: shared.vesselNm ?? '',
        trvlMode: shared.trvlMode ?? '',
        embark: shared.embark ?? '',
        accommodationStay: shared.accommodationStay ?? '',
        accommodationAddress1: shared.accommodationAddress1 ?? '',
        accommodationAddress2: shared.accommodationAddress2 ?? '',
        accommodationState: shared.accommodationState ?? '',
        accommodationPostcode: shared.accommodationPostcode ?? '',
        accommodationCity: shared.accommodationCity ?? '',
    };
}

export async function createMdacSubmission(api: ShopApi, input: Record<string, string>) {
    const { createMdacSubmission: submission } = await api.request<{
        createMdacSubmission: MdacSubmissionView;
    }>(
        `mutation CreateMdacSubmission($input: MdacSubmissionInput!) {
            createMdacSubmission(input: $input) { ${viewFields} }
        }`,
        { input },
    );
    return submission;
}

export async function readMdacSubmission(api: ShopApi, id: string, signal: AbortSignal) {
    const { mdacSubmission } = await api.request<{ mdacSubmission: MdacSubmissionView | null }>(
        `query MdacSubmission($id: ID!) { mdacSubmission(id: $id) { ${viewFields} } }`,
        { id },
        signal,
    );
    return mdacSubmission;
}

export async function readMdacSubmissionReceipt(api: ShopApi, id: string, signal: AbortSignal) {
    const { mdacSubmissionReceipt } = await api.request<{
        mdacSubmissionReceipt: MdacSubmissionReceipt | null;
    }>(
        `query MdacSubmissionReceipt($id: ID!) {
            mdacSubmissionReceipt(id: $id) { fileName mimeType base64 }
        }`,
        { id },
        signal,
    );
    return mdacSubmissionReceipt;
}

const STORAGE_KEY = 'storefront-mdac:submissions:v1';
const terminal: MdacSubmissionStatus[] = ['DONE', 'FAILED', 'MANUAL'];

export function isTerminalSubmission(status: MdacSubmissionStatus) {
    return terminal.includes(status);
}

export function readSubmissionRecord(): Record<string, Array<{ id: string; name: string }>> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, Array<{ id: string; name: string }>>;
    } catch {
        return {};
    }
}

export function saveSubmissionRecord(scope: string, entries: Array<{ id: string; name: string }>) {
    try {
        const all = readSubmissionRecord();
        all[scope] = entries;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // The submission itself is stored server-side; a lost pointer only hides the shortcut.
    }
}
