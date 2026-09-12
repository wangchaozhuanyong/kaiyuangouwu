// Schema and operations are shared with Next Admin.
export {
    BatchCreateIcloudVirtualEmailsDocument as batchCreateIcloudVirtualEmailsMutation,
    CreateIcloudPrimaryAccountDocument as createIcloudPrimaryAccountMutation,
    CreateIcloudVirtualEmailDocument as createIcloudVirtualEmailMutation,
    DeleteIcloudMailDocument as deleteIcloudMailMutation,
    DeleteIcloudPrimaryAccountDocument as deleteIcloudPrimaryAccountMutation,
    DeleteIcloudVirtualEmailDocument as deleteIcloudVirtualEmailMutation,
    IcloudPrimaryAccountsDocument as icloudPrimaryAccountsQuery,
    IcloudReceivedMailsDocument as icloudReceivedMailsQuery,
    IcloudVirtualEmailsDocument as icloudVirtualEmailsQuery,
    ReassignIcloudMailDocument as reassignIcloudMailMutation,
    ResetIcloudMasterCodeDocument as resetIcloudMasterCodeMutation,
    ResetIcloudVirtualEmailCodeDocument as resetIcloudVirtualEmailCodeMutation,
    SyncIcloudAccountDocument as syncIcloudAccountMutation,
    TestIcloudConnectionDocument as testIcloudConnectionMutation,
    UpdateIcloudPrimaryAccountDocument as updateIcloudPrimaryAccountMutation,
    UpdateIcloudVirtualEmailDocument as updateIcloudVirtualEmailMutation,
} from '../client/admin.generated';
