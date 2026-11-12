// Negative fixture for LP002: catch blocks that throw a new error AND keep the caught one.
// Must NOT be reported by any rule.

class AppError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
class WrappedError extends Error {
  constructor(message: string, readonly original: unknown) {
    super(message);
  }
}
class ApiError extends Error {
  constructor(details: { message?: string; cause?: unknown }) {
    super(details.message, { cause: details.cause });
  }
}
declare function step(): void;
declare const extraOptions: ErrorOptions;

export function withCause() {
  try {
    step();
  } catch (err) {
    throw new Error("Step failed", { cause: err });
  }
}

export function withShorthandCause() {
  try {
    step();
  } catch (cause) {
    throw new Error("Step failed", { cause });
  }
}

export function rethrow() {
  try {
    step();
  } catch (err) {
    throw err;
  }
}

export function customClassWithOptions() {
  try {
    step();
  } catch (err) {
    throw new AppError("Step failed", { cause: err });
  }
}

export function customClassWithErrorArgument() {
  try {
    step();
  } catch (err) {
    throw new WrappedError("Step failed", err);
  }
}

export function customClassWithObject() {
  try {
    step();
  } catch (err) {
    throw new ApiError({ message: "Step failed", cause: err });
  }
}

export function aggregate() {
  try {
    step();
  } catch (err) {
    throw new AggregateError([err], "All attempts failed");
  }
}

export function messageAndCause() {
  try {
    step();
  } catch (err) {
    throw new Error((err as Error).message, { cause: err });
  }
}

// The options live in a variable: we cannot see inside, so we do not guess.
export function optionsVariable() {
  try {
    step();
  } catch (err) {
    throw new Error("Step failed", extraOptions);
  }
}

export function spreadOptionsAndCause() {
  try {
    step();
  } catch (err) {
    throw (new RangeError("Step failed", { ...extraOptions, cause: err as Error }));
  }
}
