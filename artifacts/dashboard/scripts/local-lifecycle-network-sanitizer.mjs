const GOOGLE_FONTS_HOST = String.raw`(?:fonts\.googleapis\.com|fonts\.gstatic\.com)`;

export function stripGoogleFontsLinks(html) {
  return html.replace(
    new RegExp(
      String.raw`<link\b(?=[^>]*\bhref\s*=\s*["']https?:\/\/${GOOGLE_FONTS_HOST}\/?)[^>]*>\s*`,
      "giu",
    ),
    "",
  );
}

export function stripGoogleFontsImports(css) {
  return css
    .replace(
      new RegExp(
        String.raw`@import\s+(?:url\(\s*)?(["'])https?:\/\/${GOOGLE_FONTS_HOST}\/[\s\S]*?\1\s*\)?\s*;`,
        "giu",
      ),
      "",
    )
    .replace(
      new RegExp(
        String.raw`@import\s+url\(\s*https?:\/\/${GOOGLE_FONTS_HOST}\/[^)]*?\)\s*;`,
        "giu",
      ),
      "",
    )
    .replaceAll("'Outfit', sans-serif", "system-ui, sans-serif")
    .replaceAll('"Outfit", sans-serif', "system-ui, sans-serif")
    .replaceAll("'Space Mono', monospace", "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace")
    .replaceAll('"Space Mono", monospace', "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
}
