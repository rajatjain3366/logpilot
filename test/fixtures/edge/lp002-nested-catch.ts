// Edge fixture for LP002: a catch inside a catch. Each throw is judged only against the
// catch it is directly in, and reported at most once.
//   - the inner throw drops rollbackError -> reported once, severity "high", confidence "high"
//   - the outer throw keeps saveError as its cause -> not reported

declare function save(): void;
declare function rollback(): void;

export function saveWithRollback(): void {
  try {
    save();
  } catch (saveError) {
    try {
      rollback();
    } catch (rollbackError) {
      throw new Error("Rollback failed");
    }
    throw new Error("Save failed", { cause: saveError });
  }
}
