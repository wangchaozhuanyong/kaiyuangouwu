# Store Domain Plugin

This local Vendure plugin lets each Channel bind one or more external domains. A verified request
host is resolved to its Channel on the Shop API before Vendure creates the request context.

## Runtime configuration

The dev server reads these variables:

- `STORE_DOMAIN_CNAME_TARGET`: public ingress hostname shown to merchants as the CNAME/ALIAS target.
- `STORE_DOMAIN_ROUTING_MODE`: production requires `require-domain` and fails startup for an insecure
  value; development defaults to `prefer-domain` for token-based local testing.
- `STORE_DOMAIN_TRUST_PROXY`: set to `true` only when a trusted reverse proxy always removes
  and rewrites the incoming `X-Forwarded-Host` header.
- `STORE_DOMAIN_BYPASS_HOSTS`: comma-separated internal hosts that retain normal Vendure token routing.
  Production defaults to no bypass hosts.

Run the `1786515900000-add-store-domains.ts` migration before enabling the plugin against an existing
database.

## DNS and TLS

Each merchant creates the two records displayed on the Channel detail page:

1. A CNAME (or provider-specific ALIAS/ANAME for an apex domain) pointing to
   `STORE_DOMAIN_CNAME_TARGET`.
2. The generated TXT ownership record.

The application verifies ownership through public DNS. The load balancer or ingress must accept all
merchant hosts, preserve the original host, route them to this Vendure service, and issue TLS
certificates. Manual mode leaves certificate automation to the deployment layer; the optional
Cloudflare mode below provisions the public edge certificate through Cloudflare for SaaS.

## Cloudflare one-click automation

The plugin can optionally provision Cloudflare for SaaS custom hostnames, edge certificates, and
DNS records directly from the Dashboard. Configure the runtime with:

- `STORE_DOMAIN_AUTOMATION_MODE=cloudflare-saas`
- `CLOUDFLARE_SAAS_API_TOKEN` from the production secret store
- `CLOUDFLARE_SAAS_ZONE_ID` for the SaaS provider zone
- `CLOUDFLARE_SAAS_FALLBACK_ORIGIN` for the proxied origin hostname
- `CLOUDFLARE_SAAS_AUTO_MANAGE_DNS=true` only when the scoped token may manage customer zones in the
  same Cloudflare account

Adding a domain always creates or reuses one exact Cloudflare custom hostname. When its authoritative
zone is available to the same token, the plugin creates the proxied CNAME and Vendure TXT ownership
record without overwriting conflicting A, AAAA, or CNAME records. Domains outside that account keep
the two manual DNS instructions in the Dashboard while Cloudflare still automates the edge
certificate after the customer points the CNAME.

The worker reconciles pending domains every minute. A domain becomes `ACTIVE` only when the Vendure
TXT ownership record resolves and both Cloudflare hostname and SSL statuses are `active`. Deleting a
Dashboard binding removes the recorded Cloudflare custom hostname but deliberately leaves DNS records
in place for recoverability.

The token must be narrowly scoped to custom-hostname read/write on the SaaS zone. Enabling managed DNS
also requires zone read and DNS edit for only the customer zones the platform is allowed to manage.
Never put the token in source control, GraphQL responses, logs, or command-line arguments.

The production ingress uses the SaaS fallback-origin SNI and preserves the merchant `Host`. Its HTTPS
default storefront therefore serves the shared client, while strict Shop API host routing continues
to reject unregistered and pending domains.

In production, do not send the public Channel token from the storefront. The storefront defaults to
that behavior; `VITE_CLIENT_CHANNEL_SWITCHING=true` is intended only for explicit compatibility
setups.
