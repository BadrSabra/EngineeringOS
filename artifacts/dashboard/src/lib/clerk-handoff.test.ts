import {
  parseClerkSignInTokenResponse,
  parseClerkUserLookupResponse,
} from "./clerk-handoff";
import { resolveClerkPublishableKey } from "./clerk";

vi.mock("@clerk/themes", () => ({ shadcn: {} }));
vi.mock("@clerk/react/internal", () => ({
  publishableKeyFromHost: (hostname: string, fallback?: string) =>
    fallback ?? `clerk.${hostname}`,
}));

describe("Clerk release handoff response contracts", () => {
  it("accepts the bare-array user lookup response", () => {
    expect(
      parseClerkUserLookupResponse([{ id: "user_array" }]),
    ).toBe("user_array");
  });

  it("accepts the paginated user lookup response", () => {
    expect(
      parseClerkUserLookupResponse({ data: [{ id: "user_data" }] }),
    ).toBe("user_data");
  });

  it("returns no id when a valid lookup has no matching users", () => {
    expect(parseClerkUserLookupResponse({ data: [] })).toBeUndefined();
  });

  it("identifies a changed user lookup response shape", () => {
    expect(() => parseClerkUserLookupResponse({ users: [{ id: "user" }] }))
      .toThrow(
        "Clerk user lookup response shape changed: expected an array or an object with a data array.",
      );
  });

  it("identifies a changed sign-in-token response shape", () => {
    expect(() => parseClerkSignInTokenResponse({ sign_in_token: "token" }))
      .toThrow(
        "Clerk sign-in-token response shape changed: expected an object with a non-empty token.",
      );
  });

  it("returns the sign-in token from Clerk's response", () => {
    expect(parseClerkSignInTokenResponse({ token: "ticket_token" })).toBe(
      "ticket_token",
    );
  });
});

describe("Clerk browser configuration", () => {
  it("rejects a missing public key before Clerk can synthesize a bad host key", () => {
    expect(() => resolveClerkPublishableKey("preview.example", undefined))
      .toThrow(
        "Clerk is not configured for this dashboard build. Set VITE_CLERK_PUBLISHABLE_KEY",
      );
  });

  it("passes the public key through host-aware resolution", () => {
    expect(
      resolveClerkPublishableKey("custom.example", " pk_test_example "),
    ).toBe("pk_test_example");
  });
});
