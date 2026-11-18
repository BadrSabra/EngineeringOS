import { execFileSync } from "node:child_process";

const PLAYWRIGHT_NIX_LIBRARIES = [
  "glib",
  "nss",
  "atk",
  "at-spi2-atk",
  "cups",
  "dbus",
  "expat",
  "fontconfig",
  "freetype",
  "libdrm",
  "libgbm",
  "libxkbcommon",
  "alsa-lib",
  "pango",
  "cairo",
  "wayland",
  "xorg.libX11",
  "xorg.libXcomposite",
  "xorg.libXdamage",
  "xorg.libXext",
  "xorg.libXfixes",
  "xorg.libXi",
  "xorg.libXrandr",
  "xorg.libXrender",
  "xorg.libXScrnSaver",
  "xorg.libXtst",
  "xorg.libxcb",
  "mesa",
  "xorg.libXcursor",
  "gtk3",
  "gdk-pixbuf",
  "nspr",
  "at-spi2-core",
];

// Replit shell tests do not inherit the shared-library paths for packages in
// .replit, so expose those libraries only to the Playwright browser process.
function findNixpkgsPath(nixPath) {
  for (const entry of (nixPath ?? "").split(":")) {
    const separator = entry.indexOf("=");
    if (separator > 0 && entry.slice(0, separator) === "nixpkgs") {
      return entry.slice(separator + 1);
    }
  }
  return null;
}

export function withPlaywrightNixLibraries(
  environment,
  runNix = execFileSync,
) {
  const nixpkgsPath = findNixpkgsPath(environment.NIX_PATH);
  if (!nixpkgsPath) return environment;
  if (!nixpkgsPath.startsWith("/nix/store/")) {
    throw new Error(
      "Playwright Nix libraries require the configured nixpkgs store path.",
    );
  }

  const libraryList = PLAYWRIGHT_NIX_LIBRARIES.map(
    (name) => `pkgs.${name}`,
  ).join(" ");
  const expression = `let pkgs = import ${JSON.stringify(nixpkgsPath)} {}; in pkgs.lib.makeLibraryPath [ ${libraryList} ]`;
  let nixLibraryPath;
  try {
    nixLibraryPath = runNix(
      "nix",
      ["eval", "--impure", "--raw", "--expr", expression],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    throw new Error(
      "Could not resolve Playwright's runtime libraries from the configured Nix packages.",
    );
  }

  if (!nixLibraryPath) {
    throw new Error("Nix returned an empty Playwright library path.");
  }
  const libraryPaths = [
    ...nixLibraryPath.split(":"),
    ...(environment.LD_LIBRARY_PATH ?? "").split(":"),
  ].filter(Boolean);

  return {
    ...environment,
    LD_LIBRARY_PATH: [...new Set(libraryPaths)].join(":"),
  };
}
