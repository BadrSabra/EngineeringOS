import {
  parseClerkSignInTokenResponse,
  parseClerkUserLookupResponse,
} from "./clerk-handoff";

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