// Both admin clients consume the same generated, schema-checked operations.
export {
    BatchCreateIcloudVirtualEmailsDocument as BATCH_CREATE_ICLOUD_VIRTUAL_EMAILS_MUTATION,
    CreateIcloudPrimaryAccountDocument as CREATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    CreateIcloudVirtualEmailDocument as CREATE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    DeleteIcloudPrimaryAccountDocument as DELETE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    DeleteIcloudVirtualEmailDocument as DELETE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    IcloudPrimaryAccountsDocument as ICLOUD_PRIMARY_ACCOUNTS_QUERY,
    IcloudReceivedMailsDocument as ICLOUD_RECEIVED_MAILS_QUERY,
    IcloudVirtualEmailsDocument as ICLOUD_VIRTUAL_EMAILS_QUERY,
    ResetIcloudMasterCodeDocument as RESET_ICLOUD_MASTER_CODE_MUTATION,
    ResetIcloudVirtualEmailCodeDocument as RESET_ICLOUD_VIRTUAL_EMAIL_CODE_MUTATION,
    SyncIcloudAccountDocument as SYNC_ICLOUD_ACCOUNT_MUTATION,
    TestIcloudConnectionDocument as TEST_ICLOUD_CONNECTION_MUTATION,
    UpdateIcloudPrimaryAccountDocument as UPDATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    UpdateIcloudVirtualEmailDocument as UPDATE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
} from '../../../icloud-relay-plugin/src/client/admin.generated.js';

export type {
    IcloudAccountStatus,
    IcloudPrimaryAccountFieldsFragment as IcloudPrimaryAccount,
    IcloudPrimaryAccountsQuery as IcloudPrimaryAccountsResult,
    IcloudReceivedMailFieldsFragment as IcloudReceivedMail,
    IcloudReceivedMailsQuery as IcloudReceivedMailsResult,
    IcloudVirtualEmailFieldsFragment as IcloudVirtualEmail,
    IcloudVirtualEmailStatus,
    IcloudVirtualEmailsQuery as IcloudVirtualEmailsResult,
} from '../../../icloud-relay-plugin/src/client/admin.generated.js';
