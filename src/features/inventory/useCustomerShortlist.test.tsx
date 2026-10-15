// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clearCustomerShortlist, useCustomerShortlist } from "./useCustomerShortlist";
import type { InventoryVehicle } from "./types";

const vehicle = (id = "SYNTHETIC-1"): InventoryVehicle => ({
  id,
  vin: id,
  stockNumber: id,
  year: 2026,
  make: "Ford",
  model: "F-150",
  price: 42000,
  imageUrl: null,
  imageUrls: [],
  exteriorColor: "Oxford White",
} as unknown as InventoryVehicle);

beforeEach(clearCustomerShortlist);
afterEach(() => {
  cleanup();
  clearCustomerShortlist();
});

describe("useCustomerShortlist context reset", () => {
  it("clears selections when the access context changes without restoring the previous set", () => {
    const { result, rerender } = renderHook(
      ({ context }) => useCustomerShortlist(context),
      { initialProps: { context: "manager:Howell:A" } },
    );
    act(() => result.current.add(vehicle()));
    expect(result.current.count).toBe(1);

    rerender({ context: "sales:Fowlerville:B" });
    expect(result.current.count).toBe(0);
    expect(result.current.entries).toEqual([]);

    rerender({ context: "manager:Howell:A" });
    expect(result.current.count).toBe(0);
  });

  it("ignores stale mutators from a previous access context", () => {
    const { result, rerender } = renderHook(
      ({ context }) => useCustomerShortlist(context),
      { initialProps: { context: "manager:Howell:A" } },
    );
    act(() => result.current.add(vehicle("SYNTHETIC-A")));
    const staleAdd = result.current.add;
    const staleToggle = result.current.toggle;

    rerender({ context: "sales:Fowlerville:B" });
    act(() => {
      staleAdd(vehicle("SYNTHETIC-STALE"));
      staleToggle(vehicle("SYNTHETIC-STALE"));
    });
    expect(result.current.count).toBe(0);

    act(() => result.current.add(vehicle("SYNTHETIC-B")));
    expect(result.current.entries.map((entry) => entry.id)).toEqual(["SYNTHETIC-B"]);
  });

  it("keeps authorized projection pruning after a context switch", () => {
    const kept = vehicle("SYNTHETIC-KEEP");
    const gone = vehicle("SYNTHETIC-GONE");
    const { result, rerender } = renderHook(
      ({ context, authorized }) => useCustomerShortlist(context, authorized),
      { initialProps: { context: "manager:Howell:A", authorized: [kept, gone] } },
    );
    act(() => {
      result.current.add(kept);
      result.current.add(gone);
    });
    expect(result.current.count).toBe(2);

    rerender({ context: "manager:Howell:A", authorized: [kept] });
    expect(result.current.entries.map((entry) => entry.id)).toEqual(["SYNTHETIC-KEEP"]);
  });
});
