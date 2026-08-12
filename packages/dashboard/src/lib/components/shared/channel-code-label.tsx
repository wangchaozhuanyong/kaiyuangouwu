import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { Trans } from '@lingui/react/macro';

export function ChannelCodeLabel({ code }: Readonly<{ code: string }> | Readonly<{ code: undefined }>) {
    if (code === DEFAULT_CHANNEL_CODE) {
        return <Trans>Default channel</Trans>;
    }
    if (code === 'cn-mainland') {
        return <Trans id="channel.cnMainland">China Mainland</Trans>;
    }
    if (code === 'my-malaysia') {
        return <Trans id="channel.malaysia">Malaysia</Trans>;
    }
    return code;
}
