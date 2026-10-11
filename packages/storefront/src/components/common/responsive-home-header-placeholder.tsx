import { BrandLogo } from '../../storefront-ui/brand-logo';

/** Reserve the existing desktop header while the anonymous snapshot hands over to runtime. */
export function ResponsiveHomeHeaderPlaceholder({ name, logoUrl }: { name: string; logoUrl: string | null }) {
    return (
        <header className="responsive-home-header-placeholder proto-desktop-header" aria-hidden="true">
            <div className="proto-header-inner">
                <span className="proto-brand">
                    <BrandLogo url={logoUrl} name={name} className="proto-brand-badge" />
                    <span className="proto-brand-text">{name}</span>
                </span>
            </div>
        </header>
    );
}
