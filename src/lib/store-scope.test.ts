import { describe, expect, it } from "vitest";
import { groupScopeLabel, parseStoreScope } from "./store-scope";

describe("store-scope", () => {
  it("parses canonical and legacy Service values", () => {
    expect(parseStoreScope("home")).toBe("home");
    expect(parseStoreScope("group")).toBe("group");
    expect(parseStoreScope("my_store")).toBe("home");
    expect(parseStoreScope("all")).toBe("group");
    expect(parseStoreScope("unknown")).toBeNull();
    expect(parseStoreScope(null)).toBeNull();
  });

  it("keeps inventory wording distinct from workflow ledgers", () => {
    expect(groupScopeLabel("inventory")).toBe("All locations");
    expect(groupScopeLabel("workflow")).toBe("All stores");
  });
});
