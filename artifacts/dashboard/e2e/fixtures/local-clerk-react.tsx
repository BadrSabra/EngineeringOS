import {
  createElement,
  Fragment,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  isLocalE2EAuthEnabled,
  LOCAL_E2E_AUTH_STORAGE_KEY,
  LOCAL_E2E_TEST_USER,
} from "./local-e2e-auth";

type LocalUser = typeof LOCAL_E2E_TEST_USER;
type Listener = (state: { user: LocalUser | null }) => void;

const listeners = new Set<() => void>();

function currentUser(): LocalUser | null {
  return isLocalE2EAuthEnabled() ? LOCAL_E2E_TEST_USER : null;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.add(listener);
  window.addEventListener("storage", listener);
  window.addEventListener("engineeringos:local-e2e-auth", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener("engineeringos:local-e2e-auth", listener);
  };
}

function notifyAuthChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("engineeringos:local-e2e-auth"));
  for (const listener of listeners) listener();
}

export function setLocalE2EAuth(signedIn: boolean): void {
  if (typeof window === "undefined") return;
  if (signedIn) {
    window.localStorage.setItem(LOCAL_E2E_AUTH_STORAGE_KEY, "signed-in");
  } else {
    window.localStorage.removeItem(LOCAL_E2E_AUTH_STORAGE_KEY);
  }
  notifyAuthChange();
}

function useSignedInSnapshot(): boolean {
  return useSyncExternalStore(
    subscribe,
    isLocalE2EAuthEnabled,
    () => false,
  );
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return createElement(Fragment, null, children);
}

export function Show({
  when,
  children,
}: {
  when: "signed-in" | "signed-out";
  children: ReactNode;
}) {
  const signedIn = useSignedInSnapshot();
  return (when === "signed-in") === signedIn
    ? createElement(Fragment, null, children)
    : null;
}

export function useUser() {
  const signedIn = useSignedInSnapshot();
  return {
    isLoaded: true,
    isSignedIn: signedIn,
    user: signedIn ? LOCAL_E2E_TEST_USER : null,
  };
}

const addListener = (listener: Listener) => {
  const update = () => listener({ user: currentUser() });
  listeners.add(update);
  update();
  return () => listeners.delete(update);
};

const signOut = async () => {
  setLocalE2EAuth(false);
  window.location.assign("/dashboard/");
};

const redirectToSignIn = async () => {
  window.location.assign("/dashboard/sign-in");
};

export function useClerk() {
  return { addListener, signOut, redirectToSignIn };
}

function LocalAuthButton({ label }: { label: string }) {
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => {
        setLocalE2EAuth(true);
        window.location.assign("/dashboard/");
      },
    },
    label,
  );
}

export function SignIn() {
  return createElement(LocalAuthButton, { label: "Continue isolated test session" });
}

export function SignUp() {
  return createElement(LocalAuthButton, { label: "Start isolated test session" });
}
