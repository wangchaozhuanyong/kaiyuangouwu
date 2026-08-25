import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { useLingui } from '@lingui/react/macro';

/**
 * Returns the localized, user-facing name for a Channel code.
 *
 * Raw Channel codes are implementation identifiers and should only be rendered
 * directly in technical fields such as API tokens or explicit "code" rows.
 */
export function useChannelDisplayName(code: string | undefined): string {
    const { t } = useLingui();

    if (!code) {
        return '';
    }
    if (code === DEFAULT_CHANNEL_CODE) {
        return t`Default channel`;
    }
    if (code === 'cn-mainland') {
        return t({ id: 'channel.cnMainland', message: 'China Mainland' });
    }
    if (code === 'my-malaysia') {
        return t({ id: 'channel.malaysia', message: 'Malaysia' });
    }
    return code;
}

export function ChannelCodeLabel({ code }: Readonly<{ code: string }> | Readonly<{ code: undefined }>) {
    return useChannelDisplayName(code);
}
