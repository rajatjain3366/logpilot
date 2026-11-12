// Edge fixture for LP002: the caught error is logged, then a NEW error is thrown without it.
// Each throw must be reported with severity "low", confidence "medium" (case A1): the
// details exist in the logs, but nothing links them to the new error.

interface Logger {
  error(...args: unknown[]): void;
}
declare const logger: Logger;
declare function pushOrders(): Promise<void>;
declare function loadModule(name: string): unknown;

export async function syncOrders(): Promise<void> {
  try {
    await pushOrders();
  } catch (err) {
    logger.error({ err }, "order sync failed");
    throw new Error("Order sync failed");
  }
}

export function loadPlugin(name: string): unknown {
  try {
    return loadModule(name);
  } catch (error) {
    console.error("plugin failed to load", error);
    throw new Error(`Plugin ${name} could not be loaded`);
  }
}
