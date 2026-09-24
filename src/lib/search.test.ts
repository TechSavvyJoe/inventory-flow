import { describe, expect, it } from "vitest";
import { foldSearchText, searchFieldsMatch } from "./search";

describe("shared search matcher", () => {
  it("reuses token and typo matching across explicit view fields", () => {
    expect(searchFieldsMatch("ford howel", ["2024 Ford Explorer", "Howell"])).toBe(true);
    expect(searchFieldsMatch("ford lincoln", ["2024 Ford Explorer", "Howell"])).toBe(false);
  });

  it("folds joining punctuation and currency, and an empty query matches everything", () => {
    expect(foldSearchText("F-150")).toBe("f150");
    expect(foldSearchText("$42,810")).toBe("42810");
    expect(searchFieldsMatch("f150", ["2024 Ford F-150"])).toBe(true);
    expect(searchFieldsMatch("  ", ["anything"])).toBe(true);
  });
});
