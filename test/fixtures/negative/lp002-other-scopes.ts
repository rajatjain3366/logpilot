// Negative fixture for LP002: throws that do NOT leave a catch block directly, and throws
// that are not new errors. Must NOT be reported by any rule (see README "What LP002 will miss").

declare function step(): void;
declare function retry(): void;
declare const jobs: Array<string | undefined>;
declare function fetchData(): Promise<unknown>;

// Throws inside callbacks and nested functions run later (or never), not when the catch exits.
export function laterCallbacks() {
  try {
    step();
  } catch (err) {
    setTimeout(() => {
      throw new Error("timer failed");
    }, 0);
    jobs.forEach(function (job) {
      if (!job) throw new Error("empty job");
    });
    function helper() {
      throw new Error("helper failed");
    }
    class Retrier {
      run() {
        throw new Error("retry failed");
      }
    }
    throw err;
  }
}

// A throw inside an inner try block is caught by that try's own catch.
export function caughtLocally() {
  try {
    step();
  } catch (err) {
    try {
      retry();
      throw new Error("retry gave no result");
    } catch (retryError) {
      throw new Error("Retry failed", { cause: retryError });
    }
  }
}

// A throw in the try block itself is not inside a catch.
export function inTryBlock() {
  try {
    throw new Error("not inside a catch");
  } catch (err) {
    throw err;
  }
}

// Not a new Error object: out of scope for LP002 (a possible future rule).
export function notAnErrorObject() {
  try {
    step();
  } catch (err) {
    throw "something went wrong";
  }
}

// Promise .catch() callbacks are not try/catch statements (a known gap, see README).
export function promiseCatch() {
  return fetchData().catch((err) => {
    throw new Error("fetch failed");
  });
}
