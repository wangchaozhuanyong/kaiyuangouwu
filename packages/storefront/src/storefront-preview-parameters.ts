// The Admin owns a srcdoc iframe, so its preview has no route query string.
// Standalone client previews continue to read the URL as before.
let embeddedParameters: URLSearchParams | undefined;

export function setStorefrontPreviewParameters(parameters: URLSearchParams) {
    embeddedParameters = parameters;
}

export function storefrontPreviewParameters(): URLSearchParams {
    return (
        embeddedParameters ?? new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
    );
}

export function storefrontDocumentUrl(): string {
    return embeddedParameters?.get('storefrontPreviewDocumentUrl') ?? window.location.href;
}
