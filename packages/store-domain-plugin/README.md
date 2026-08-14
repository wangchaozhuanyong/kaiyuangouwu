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
certificates. Certificate automation is intentionally owned by the deployment layer rather than the
Vendure process.

In production, do not send the public Channel token from the storefront. The storefront defaults to
that behavior; `VITE_CLIENT_CHANNEL_SWITCHING=true` is intended only for explicit compatibility
setups.
