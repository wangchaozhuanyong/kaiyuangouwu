const authenticationRequiredPattern = /you are not currently authorized to perform this action|authentication required|invalid authentication/i;

export function isAuthenticationRequiredError(error: unknown) {
  if (error instanceof Error) return authenticationRequiredPattern.test(error.message);
  return authenticationRequiredPattern.test(String(error ?? ''));
}
