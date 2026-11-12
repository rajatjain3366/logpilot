// Positive fixture for LP001 (rule 1 must NOT apply): comments that do not explain the empty
// catch. Each catch below must still be reported with severity "high", confidence "high".

declare function load(id: string): unknown;
declare function requireOptional(name: string): unknown;

// An annotation embedded in code is for another tool (here a bundler), not an explanation.
export function loadPnp(): unknown {
  try {
    return requireOptional(/* #__KEEP__ */ "pnpapi");
  } catch {}
  return undefined;
}

// A comment separated from the try by code is about that code.
export function loadUser(id: string): unknown {
  // Build the cache key.
  const key = `user:${id}`;
  try {
    return load(key);
  } catch {}
  return undefined;
}

// A comment separated from the try by a blank line is not "directly above" it.
export function loadOrder(id: string): unknown {
  // Look up the order.

  try {
    return load(id);
  } catch {}
  return undefined;
}

// A comment at the end of the previous line of code belongs to that line.
export function loadItem(id: string): unknown {
  const key = id.trim(); // ids may contain spaces
  try {
    return load(key);
  } catch {}
  return undefined;
}
