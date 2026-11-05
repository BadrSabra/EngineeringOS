/**
 * Browser-only session state for controlled local dashboard journeys.
 *
 * This value changes only the client fixture UI; it is not an API credential.
 * The lifecycle runner assigns its own fixed test identity in the API, while
 * the protected-page visual runner starts no API and intercepts reads with
 * static browser fixtures.
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
