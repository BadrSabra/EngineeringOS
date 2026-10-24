import type { ReactNode } from "react";

const localUser = {
  id: "test-user",
  fullName: "EngineeringOS Lifecycle Test",
  username: "engineeringos-lifecycle-test",
  primaryEmailAddress: {
    emailAddress: "engineeringos-lifecycle@example.invalid",
  },
};

/**
 * Browser-only Clerk surface for the isolated lifecycle E2E.
 *
 * The API independently assigns its fixed NODE_ENV=test identity. This mock
 * never supplies backend identity or project ownership; those remain subject
 * to the normal server-side authorization checks.
 */
export function ClerkProvider({
  children,
}: {
  children?: ReactNode;
  [key: string]: unknown;
}) {
  return <>{children}</>;
}

export function Show({
  when,
  children,
  fallback,
}: {
  when?: string;
  children?: ReactNode;
  fallback?: ReactNode;
}) {
  return <>{when === "signed-in" ? children : fallback}</>;
}

export function useUser() {
  return { isLoaded: true, isSignedIn: true, user: localUser };
}

export function useClerk() {
  return {
    addListener: () => () => undefined,
    signOut: async () => undefined,
    redirectToSignIn: () => undefined,
  };
}

export function SignIn() {
  return <div role="status">Local lifecycle test sign-in fixture.</div>;
}

export function SignUp() {
  return <div role="status">Local lifecycle test sign-up fixture.</div>;
}

export function publishableKeyFromHost(_host: string, key: string) {
  return key;
}
