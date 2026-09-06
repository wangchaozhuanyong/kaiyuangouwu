import { gql } from '@apollo/client';
import type { NormalizedCatalogRow } from '@vendure/catalog-management-plugin/browser';

export type CatalogImportState =
    | 'RECEIVING'
    | 'PREVIEW_READY'
    | 'QUEUED'
    | 'RUNNING'
    | 'COMPLETED'
    | 'COMPLETED_WITH_ERRORS'
    | 'FAILED'
    | 'ROLLED_BACK';

export type CatalogImportAction =
    'PENDING' | 'CREATE' | 'UPDATE' | 'SKIP_UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';

export type CatalogImportResolution = 'APPLY' | 'CREATE_NEW' | 'UPDATE_EXISTING' | 'SKIP';

export interface CatalogImportJobRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    channelId: string;
    stockLocationId: string;
    stockLocation: { id: string; name: string };
    currencyCode: string;
    clearBlankFields: boolean;
    originalFilename: string;
    byteSize: number;
    fileHash: string;
    sheetName: string | null;
    detectedHeaders: string[] | null;
    fieldMapping: Record<string, string> | null;
    state: CatalogImportState;
    totalRows: number;
    receivedRows: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    conflictCount: number;
    warningCount: number;
    errorCount: number;
    progress: number;
    errorMessage: string | null;
    completedAt: string | null;
    rolledBackAt: string | null;
}

export interface CatalogImportRowRecord {
    id: string;
    rowNumber: number;
    action: CatalogImportAction;
    resolution: CatalogImportResolution | null;
    targetProductId: string | null;
    targetVariantId: string | null;
    normalizedData: NormalizedCatalogRow;
    plannedChanges: Record<string, unknown> | null;
    message: string | null;
    appliedAt: string | null;
}

export function canExecuteCatalogImport(
    job:
        | Pick<CatalogImportJobRecord, 'state' | 'conflictCount' | 'warningCount' | 'errorCount'>
        | null
        | undefined,
    canUpdate: boolean,
): boolean {
    if (!canUpdate || !job || !['PREVIEW_READY', 'FAILED', 'COMPLETED_WITH_ERRORS'].includes(job.state)) {
        return false;
    }
    return job.conflictCount + job.warningCount + job.errorCount === 0;
}

const jobFields = gql`
    fragment NextAdminCatalogImportJobFields on CatalogImportJob {
        id
        createdAt
        updatedAt
        channelId
        stockLocationId
        stockLocation {
            id
            name
        }
        currencyCode
        clearBlankFields
        originalFilename
        byteSize
        fileHash
        sheetName
        detectedHeaders
        fieldMapping
        state
        totalRows
        receivedRows
        createdCount
        updatedCount
        skippedCount
        conflictCount
        warningCount
        errorCount
        progress
        errorMessage
        completedAt
        rolledBackAt
    }
`;

export const CATALOG_IMPORT_CONTEXT_QUERY = gql`
    query NextAdminCatalogImportContext {
        activeChannel {
            id
            code
            defaultCurrencyCode
            availableCurrencyCodes
        }
        stockLocations(options: { take: 100, sort: { name: ASC, id: ASC } }) {
            items {
                id
                name
            }
        }
    }
`;

export const BEGIN_CATALOG_IMPORT_MUTATION = gql`
    ${jobFields}
    mutation NextAdminBeginCatalogImport($input: BeginCatalogImportInput!) {
        beginCatalogImport(input: $input) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const APPEND_CATALOG_IMPORT_ROWS_MUTATION = gql`
    ${jobFields}
    mutation NextAdminAppendCatalogImportRows($input: AppendCatalogImportRowsInput!) {
        appendCatalogImportRows(input: $input) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const FINALIZE_CATALOG_IMPORT_PREVIEW_MUTATION = gql`
    ${jobFields}
    mutation NextAdminFinalizeCatalogImportPreview($id: ID!) {
        finalizeCatalogImportPreview(id: $id) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const CATALOG_IMPORT_JOB_QUERY = gql`
    ${jobFields}
    query NextAdminCatalogImportJob($id: ID!) {
        catalogImportJob(id: $id) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const CATALOG_IMPORT_JOBS_QUERY = gql`
    ${jobFields}
    query NextAdminCatalogImportJobs($skip: Int, $take: Int) {
        catalogImportJobs(skip: $skip, take: $take) {
            items {
                ...NextAdminCatalogImportJobFields
            }
            totalItems
        }
    }
`;

export const CATALOG_IMPORT_ROW_PAGE_QUERY = gql`
    query NextAdminCatalogImportRowPage($jobId: ID!, $action: CatalogImportAction, $skip: Int, $take: Int) {
        catalogImportRowPage(jobId: $jobId, action: $action, skip: $skip, take: $take) {
            items {
                id
                rowNumber
                action
                resolution
                targetProductId
                targetVariantId
                normalizedData
                plannedChanges
                message
                appliedAt
            }
            totalItems
        }
    }
`;

export const RESOLVE_CATALOG_IMPORT_ROW_MUTATION = gql`
    mutation NextAdminResolveCatalogImportRow($input: ResolveCatalogImportRowInput!) {
        resolveCatalogImportRow(input: $input) {
            id
            action
            resolution
            targetProductId
            targetVariantId
            message
        }
    }
`;

export const RESOLVE_CATALOG_IMPORT_ROWS_MUTATION = gql`
    ${jobFields}
    mutation NextAdminResolveCatalogImportRows($input: ResolveCatalogImportRowsInput!) {
        resolveCatalogImportRows(input: $input) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const EXECUTE_CATALOG_IMPORT_MUTATION = gql`
    ${jobFields}
    mutation NextAdminExecuteCatalogImport($id: ID!) {
        executeCatalogImport(id: $id) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;

export const ROLLBACK_CATALOG_IMPORT_MUTATION = gql`
    ${jobFields}
    mutation NextAdminRollbackCatalogImport($id: ID!) {
        rollbackCatalogImport(id: $id) {
            ...NextAdminCatalogImportJobFields
        }
    }
`;
