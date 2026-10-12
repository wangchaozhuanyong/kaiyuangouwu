import { SafeImage } from '../../safe-image';
import { type CustomerIdentity } from '../../types';

import '../../styles/customer-avatar.css';

/** Avatar ownership, geometry and bounded image candidates are shared by every identity surface. */
export function CustomerAvatar({
    customer,
    source,
    size = 48,
    className = '',
}: {
    customer: CustomerIdentity | null;
    source?: string | null;
    size?: 40 | 48 | 64;
    className?: string;
}) {
    const name = customer ? `${customer.lastName}${customer.firstName}`.trim() || customer.emailAddress : '';
    const initial = (
        <span className="customer-avatar-initial" aria-hidden="true">
            {Array.from(name)[0]?.toUpperCase() ?? '·'}
        </span>
    );
    const src = source ?? customer?.avatar?.preview;
    const transient = Boolean(src && /^(?:blob:|data:)/u.test(src));
    return (
        <span className={`customer-avatar ${className}`} aria-hidden="true">
            {src ? (
                <SafeImage
                    key={customer?.id ?? 'unknown'}
                    retainedOwnerKey={customer?.id ?? 'unknown'}
                    src={src}
                    imageKind={transient ? undefined : 'icon'}
                    sizes={`${size}px`}
                    width={size}
                    height={size}
                    alt=""
                    loading="eager"
                    loadingFallback={initial}
                    errorFallback={initial}
                />
            ) : (
                initial
            )}
        </span>
    );
}
