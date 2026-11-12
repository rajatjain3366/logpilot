// Negative fixture for LP001: catch blocks that report the error through a logging
// library instead of console. Must NOT be reported.

interface Logger {
  error(...args: unknown[]): void;
}
declare const logger: Logger;
declare function chargeCard(orderId: string): Promise<void>;
declare function pushInventory(): Promise<void>;

export async function checkout(orderId: string): Promise<void> {
  try {
    await chargeCard(orderId);
  } catch (err) {
    // pino style: error object (plus safe context) first, then a message
    logger.error({ err, orderId }, "payment failed");
  }
}

export async function syncInventory(): Promise<void> {
  try {
    await pushInventory();
  } catch (error) {
    // winston style: message first, then metadata
    logger.error("inventory sync failed", { error });
  }
}
