// Positive fixture for LP001 (Milestone 2.5): comments that instruct a tool (a linter, the
// TypeScript compiler, a coverage tool, a formatter) are not explanations of why an error is
// ignored, even when they carry a description. Every catch below must be reported like an
// uncommented empty catch: severity "medium", confidence "high".

declare function readCache(): string;
declare function closeSocket(): void;
declare function parse(text: string): unknown;

// An ESLint block directive directly above the try.
export function eslintDisableAbove(): void {
  /* eslint-disable no-empty */
  try {
    closeSocket();
  } catch {}
}

// An ESLint line directive after the catch, with a description after "--".
export function eslintDisableLine(): void {
  try {
    closeSocket();
  } catch (err) {} // eslint-disable-line no-empty -- closing twice is harmless
}

// An ESLint next-line directive on its own line inside the try.
export function eslintDisableNextLine(): string | undefined {
  try {
    return readCache();
    // eslint-disable-next-line no-empty
  } catch {}
  return undefined;
}

// TypeScript directives inside the try.
export function tsIgnore(value: string): unknown {
  try {
    // @ts-ignore
    return parse(value);
  } catch {}
  return undefined;
}

export function tsExpectError(value: string): unknown {
  try {
    // @ts-expect-error the value is checked at runtime
    return parse(value);
  } catch {}
  return undefined;
}

// Coverage-tool directives: inside the catch, directly above the try, after the catch.
export function istanbulIgnore(): void {
  try {
    closeSocket();
  } catch (err) {
    /* istanbul ignore next */
  }
}

export function c8Ignore(): void {
  /* c8 ignore next 3 */
  try {
    closeSocket();
  } catch {}
}

export function v8Ignore(): void {
  try {
    closeSocket();
  } catch {} /* v8 ignore next */
}

// Formatter and other linter directives.
export function prettierIgnore(): void {
  // prettier-ignore
  try { closeSocket(); } catch {}
}

export function biomeIgnore(): void {
  try {
    closeSocket();
  } catch {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: closing twice is harmless
  }
}
