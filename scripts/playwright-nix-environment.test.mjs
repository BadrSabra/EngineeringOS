import assert from "node:assert/strict";
import test from "node:test";
import { withPlaywrightNixLibraries } from "./playwright-nix-environment.mjs";

test("leaves browser environments unchanged outside a configured Nix workspace", () => {
  const environment = { PATH: "/usr/bin", LD_LIBRARY_PATH: "/system/lib" };
  assert.equal(withPlaywrightNixLibraries(environment), environment);
});

test("adds Nix browser libraries before existing shared libraries", () => {
  let invocation;
  const environment = {
    NIX_PATH:
      "nixpkgs=/nix/store/test-nixpkgs:/nix/store/test-replit-channels",
    LD_LIBRARY_PATH: "/existing/lib:/shared/lib",
  };

  const result = withPlaywrightNixLibraries(
    environment,
    (executable, args, options) => {
      invocation = { executable, args, options };
      return "/nix/store/gtk/lib:/nix/store/pango/lib";
    },
  );

  assert.equal(
    result.LD_LIBRARY_PATH,
    "/nix/store/gtk/lib:/nix/store/pango/lib:/existing/lib:/shared/lib",
  );
  assert.equal(result.PATH, undefined);
  assert.equal(invocation.executable, "nix");
  assert.deepEqual(invocation.args.slice(0, 3), [
    "eval",
    "--impure",
    "--raw",
  ]);
  assert.match(invocation.args.at(-1), /import "\/nix\/store\/test-nixpkgs"/);
  assert.match(invocation.args.at(-1), /pkgs\.gtk3/);
  assert.match(invocation.args.at(-1), /pkgs\.xorg\.libX11/);
  assert.deepEqual(invocation.options, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
});

test("does not duplicate library directories", () => {
  const result = withPlaywrightNixLibraries(
    {
      NIX_PATH: "nixpkgs=/nix/store/test-nixpkgs",
      LD_LIBRARY_PATH: "/nix/store/gtk/lib:/existing/lib",
    },
    () => "/nix/store/gtk/lib:/nix/store/pango/lib",
  );

  assert.equal(
    result.LD_LIBRARY_PATH,
    "/nix/store/gtk/lib:/nix/store/pango/lib:/existing/lib",
  );
});

test("fails explicitly when the configured Nix package set cannot be evaluated", () => {
  assert.throws(
    () =>
      withPlaywrightNixLibraries(
        { NIX_PATH: "nixpkgs=/nix/store/test-nixpkgs" },
        () => {
          throw new Error("private evaluator diagnostics");
        },
      ),
    {
      message:
        "Could not resolve Playwright's runtime libraries from the configured Nix packages.",
    },
  );
});
