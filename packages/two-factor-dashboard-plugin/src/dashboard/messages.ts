import { msg } from '@lingui/core/macro';

export const messages = {
    navSection: msg({ id: 'twoFactor.nav.section', message: 'AI services' }),
    title: msg({ id: 'twoFactor.title', message: '2FA dynamic codes' }),
    description: msg({
        id: 'twoFactor.description',
        message: 'Query codes or manage server-stored 2FA accounts in bulk.',
    }),
    batchImport: msg({ id: 'twoFactor.batchImport', message: 'Bulk import' }),
    addAccount: msg({ id: 'twoFactor.addAccount', message: 'Add account' }),
    loggedInOnly: msg({ id: 'twoFactor.loggedInOnly', message: 'Login required' }),
    quickQuery: msg({ id: 'twoFactor.quickQuery', message: 'Query a 2FA code' }),
    secret: msg({ id: 'twoFactor.secret', message: '2FA secret' }),
    secretPlaceholder: msg({ id: 'twoFactor.secretPlaceholder', message: 'Paste a Base32 secret' }),
    paste: msg({ id: 'twoFactor.paste', message: 'Paste' }),
    query: msg({ id: 'twoFactor.query', message: 'Query code' }),
    currentCode: msg({ id: 'twoFactor.currentCode', message: 'Current code' }),
    copy: msg({ id: 'twoFactor.copy', message: 'Copy' }),
    clear: msg({ id: 'twoFactor.clear', message: 'Clear' }),
    saveToList: msg({ id: 'twoFactor.saveToList', message: 'Add to account list' }),
    queryMemoryNotice: msg({
        id: 'twoFactor.queryMemoryNotice',
        message: 'This one-time query stays only in page memory and is cleared on refresh or navigation.',
    }),
    privacyTitle: msg({ id: 'twoFactor.privacyTitle', message: 'Data and privacy' }),
    privacyStorage: msg({
        id: 'twoFactor.privacyStorage',
        message: 'Storage: encrypted server database (no browser cache)',
    }),
    privacyNoDatabase: msg({
        id: 'twoFactor.privacy.noDatabase',
        message: 'Saved accounts are written to the server database',
    }),
    privacyNoUpload: msg({
        id: 'twoFactor.privacy.noUpload',
        message: 'Secrets are encrypted with AES-256-GCM at rest',
    }),
    privacyLocalGeneration: msg({
        id: 'twoFactor.privacy.localGeneration',
        message: 'Codes are generated in this browser',
    }),
    privacyRefresh: msg({ id: 'twoFactor.privacy.refresh', message: 'Account data remains after refresh' }),
    privacyClear: msg({
        id: 'twoFactor.privacy.clear',
        message: 'Logout or closing the tab does not delete saved accounts',
    }),
    privacyLimit: msg({
        id: 'twoFactor.privacy.limit',
        message: 'Available to logged-in users only · Up to 100 accounts',
    }),
    privacyPublicDevice: msg({
        id: 'twoFactor.privacy.publicDevice',
        message:
            'Decrypted secrets exist only in the current page memory while this page is open. Do not reveal them on a shared screen.',
    }),
    expandPrivacy: msg({ id: 'twoFactor.expandPrivacy', message: 'Show details' }),
    collapsePrivacy: msg({ id: 'twoFactor.collapsePrivacy', message: 'Hide details' }),
    privacySummary: msg({
        id: 'twoFactor.privacySummary',
        message: 'Encrypted server database · No browser cache',
    }),
    accountList: msg({ id: 'twoFactor.accountList', message: '2FA account list' }),
    searchPlaceholder: msg({ id: 'twoFactor.searchPlaceholder', message: 'Search project name' }),
    clearAll: msg({ id: 'twoFactor.clearAll', message: 'Clear all' }),
    projectName: msg({ id: 'twoFactor.projectName', message: 'Project name' }),
    projectNamePlaceholder: msg({
        id: 'twoFactor.projectNamePlaceholder',
        message: 'For example: ChatGPT support 01',
    }),
    dynamicCode: msg({ id: 'twoFactor.dynamicCode', message: 'Dynamic code' }),
    remainingTime: msg({ id: 'twoFactor.remainingTime', message: 'Time remaining' }),
    recentUse: msg({ id: 'twoFactor.recentUse', message: 'Last used' }),
    actions: msg({ id: 'twoFactor.actions', message: 'Actions' }),
    edit: msg({ id: 'twoFactor.edit', message: 'Edit' }),
    delete: msg({ id: 'twoFactor.delete', message: 'Delete' }),
    reveal: msg({ id: 'twoFactor.reveal', message: 'Show secret' }),
    hide: msg({ id: 'twoFactor.hide', message: 'Hide secret' }),
    neverUsed: msg({ id: 'twoFactor.neverUsed', message: 'Not used yet' }),
    justNow: msg({ id: 'twoFactor.justNow', message: 'Just now' }),
    minutesAgo: msg({ id: 'twoFactor.minutesAgo', message: 'minutes ago' }),
    hoursAgo: msg({ id: 'twoFactor.hoursAgo', message: 'hours ago' }),
    daysAgo: msg({ id: 'twoFactor.daysAgo', message: 'days ago' }),
    seconds: msg({ id: 'twoFactor.seconds', message: 'sec' }),
    codesRefresh: msg({ id: 'twoFactor.codesRefresh', message: 'Codes refresh every 30 seconds' }),
    clockHint: msg({
        id: 'twoFactor.clockHint',
        message: 'If a code is rejected, check that your device time is set automatically.',
    }),
    emptyTitle: msg({ id: 'twoFactor.emptyTitle', message: 'No saved accounts' }),
    emptyDescription: msg({
        id: 'twoFactor.emptyDescription',
        message: 'Add one account or import multiple secrets to begin.',
    }),
    addDialogTitle: msg({ id: 'twoFactor.addDialogTitle', message: 'Add 2FA account' }),
    addDialogDescription: msg({
        id: 'twoFactor.addDialogDescription',
        message: 'The account is encrypted and saved to the server database.',
    }),
    editDialogTitle: msg({ id: 'twoFactor.editDialogTitle', message: 'Edit 2FA account' }),
    editDialogDescription: msg({
        id: 'twoFactor.editDialogDescription',
        message: 'Changes are encrypted and saved to the server database.',
    }),
    cancel: msg({ id: 'twoFactor.cancel', message: 'Cancel' }),
    save: msg({ id: 'twoFactor.save', message: 'Save' }),
    batchDialogTitle: msg({ id: 'twoFactor.batchDialogTitle', message: 'Bulk import 2FA accounts' }),
    batchDialogDescription: msg({
        id: 'twoFactor.batchDialogDescription',
        message: 'Paste one account per line. Named and key-only rows are supported.',
    }),
    batchFormat: msg({
        id: 'twoFactor.batchFormat',
        message: 'Format: project name | 2FA secret, or one secret per line',
    }),
    batchPlaceholder: msg({
        id: 'twoFactor.batchPlaceholder',
        message: 'ChatGPT support 01 | JBSWY3DPEHPK3PXP\nGEZDGNBVGY3TQOJQ',
    }),
    importAccounts: msg({ id: 'twoFactor.importAccounts', message: 'Import accounts' }),
    validRows: msg({ id: 'twoFactor.validRows', message: 'Valid rows' }),
    invalidRows: msg({ id: 'twoFactor.invalidRows', message: 'Invalid rows' }),
    invalidLine: msg({ id: 'twoFactor.invalidLine', message: 'Line' }),
    invalidMissingName: msg({ id: 'twoFactor.invalidMissingName', message: 'Project name is required' }),
    invalidMissingSecret: msg({ id: 'twoFactor.invalidMissingSecret', message: '2FA secret is required' }),
    invalidSecret: msg({ id: 'twoFactor.invalidSecret', message: 'Invalid Base32 secret' }),
    invalidDuplicate: msg({ id: 'twoFactor.invalidDuplicate', message: 'Duplicate secret' }),
    invalidLimit: msg({ id: 'twoFactor.invalidLimit', message: 'The 100-account limit has been reached' }),
    projectRequired: msg({ id: 'twoFactor.projectRequired', message: 'Enter a project name' }),
    projectTooLong: msg({
        id: 'twoFactor.projectTooLong',
        message: 'Project name cannot exceed 80 characters',
    }),
    duplicateSecret: msg({ id: 'twoFactor.duplicateSecret', message: 'This 2FA secret already exists' }),
    accountLimit: msg({ id: 'twoFactor.accountLimit', message: 'You can save up to 100 accounts' }),
    queryFailed: msg({ id: 'twoFactor.queryFailed', message: 'Could not generate a code from this secret' }),
    clipboardEmpty: msg({ id: 'twoFactor.clipboardEmpty', message: 'The clipboard is empty' }),
    clipboardDenied: msg({
        id: 'twoFactor.clipboardDenied',
        message: 'Clipboard access was blocked. Paste into the field manually.',
    }),
    copied: msg({ id: 'twoFactor.copied', message: 'Code copied' }),
    copyFailed: msg({ id: 'twoFactor.copyFailed', message: 'Could not copy the code' }),
    pasted: msg({ id: 'twoFactor.pasted', message: 'Secret pasted' }),
    accountAdded: msg({ id: 'twoFactor.accountAdded', message: 'Account added' }),
    accountUpdated: msg({ id: 'twoFactor.accountUpdated', message: 'Account updated' }),
    accountDeleted: msg({ id: 'twoFactor.accountDeleted', message: 'Account deleted' }),
    accountsImported: msg({ id: 'twoFactor.accountsImported', message: 'Accounts imported' }),
    accountsCleared: msg({ id: 'twoFactor.accountsCleared', message: 'All accounts cleared' }),
    storageUnavailable: msg({
        id: 'twoFactor.storageUnavailable',
        message:
            'The server database is unavailable. You can still run a one-time query, but accounts cannot be saved.',
    }),
    legacyMigrationFailed: msg({
        id: 'twoFactor.legacyMigrationFailed',
        message:
            'Legacy browser data could not be migrated to the server database. It was kept in this browser; retry later or contact an administrator.',
    }),
    legacyMigrationLimit: msg({
        id: 'twoFactor.legacyMigrationLimit',
        message:
            'Legacy browser data exceeds the 100-account database limit. It was kept in this browser; remove server accounts before retrying.',
    }),
    deleteConfirmTitle: msg({ id: 'twoFactor.deleteConfirmTitle', message: 'Delete this account?' }),
    deleteConfirmDescription: msg({
        id: 'twoFactor.deleteConfirmDescription',
        message: 'This permanently removes the account from the server database.',
    }),
    clearConfirmTitle: msg({ id: 'twoFactor.clearConfirmTitle', message: 'Clear all 2FA accounts?' }),
    clearConfirmDescription: msg({
        id: 'twoFactor.clearConfirmDescription',
        message:
            'All 2FA accounts saved by the current administrator will be permanently removed from the server database.',
    }),
    confirmDelete: msg({ id: 'twoFactor.confirmDelete', message: 'Delete' }),
    confirmClear: msg({ id: 'twoFactor.confirmClear', message: 'Clear all' }),
} as const;

export type TwoFactorText = Record<keyof typeof messages, string>;
