// A project logger module, used by the fix-preview fixture one-hop-import.ts.
import pino from "pino";

export const appLogger = pino({ level: "info" });
