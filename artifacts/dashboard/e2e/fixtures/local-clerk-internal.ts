export function publishableKeyFromHost(
  _hostname: string,
  fallback?: string,
): string {
  return fallback ?? "pk_test_engineeringos_local_fixture";
}
