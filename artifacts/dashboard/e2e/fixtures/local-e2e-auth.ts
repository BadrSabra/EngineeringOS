/**
 * Browser-only session state for the controlled lifecycle E2E.
 *
 * The API never trusts this storage value. In the isolated runner, the API
 * process runs with NODE_ENV=test and assigns the fixed server identity
 * "test-user"; project ownership checks still run against the disposable DB.
 */
export const LOCAL_E2E_AUTH_STORAGE_KEY = "__engineeringos_local_e2e_auth_v1";

export const LOCAL_E2E_TEST_USER = Object.freeze({
  id: "test-user",
  fullName: "EngineeringOS Lifecycle Test",
  firstName: "EngineeringOS",
  lastName: "Lifecycle Test",
  imageUrl: null,
  primaryEmailAddress: {
    emailAddress: "engineeringos-lifecycle@example.invalid",
  },
});

export function isLocalE2EAuthEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(LOCAL_E2E_AUTH_STORAGE_KEY) === "signed-in"
  );
}
