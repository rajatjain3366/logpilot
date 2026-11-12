// Splitting names into words, so rules can match whole words instead of parts of words:
// "newPassword" -> ["new", "password"], "password_confirmation" -> ["password", "confirmation"],
// "x-api-key" -> ["x", "api", "key"], "server-build" -> ["server", "build"].
// Matching words (not substrings) keeps "secretary" from matching "secret", and "spinner" from "pin".

/** The lower-case words of a name: split at camelCase, PascalCase, `_`, `-`, `.`, digits and other symbols. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") //      newPassword -> new Password
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") //   APIKey -> API Key
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== "");
}
