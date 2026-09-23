import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyableValue } from "./CopyableValue";

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: originalExecCommand,
  });
  vi.restoreAllMocks();
});

function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

describe("CopyableValue", () => {
  it("copies the exact supplied text with Clipboard API and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(
      <CopyableValue label="stock number" text="0012-A ">
        0012-A
      </CopyableValue>,
    );

    const button = screen.getByRole("button", { name: "Copy stock number: 0012-A" });
    expect(button).toHaveAttribute("title", "Copy stock number: 0012-A ");
    fireEvent.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("0012-A ");
      expect(screen.getByRole("status")).toHaveTextContent("stock number copied");
    });
    expect(writeText).toHaveBeenCalledOnce();
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("exposes a typed button, a polite live region, and a Copied state on the button itself", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<CopyableValue label="VIN" text="1FTFW1E86HFA48871" />);

    const button = screen.getByRole("button", { name: "Copy VIN: 1FTFW1E86HFA48871" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent("Copied"));
    expect(writeText).toHaveBeenCalledWith("1FTFW1E86HFA48871");
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("VIN copied");
  });

  it("falls back to the selected textarea when Clipboard API is blocked", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    let selectedText = "";
    const execCommand = vi.fn(() => {
      selectedText = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    render(<CopyableValue label="VIN" text="TESTDATASYN000002" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy VIN: TESTDATASYN000002" }));

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(screen.getByRole("status")).toHaveTextContent("VIN copied");
    });
    expect(selectedText).toBe("TESTDATASYN000002");
  });

  it("announces failure without copying surrounding or hidden content", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("blocked")) });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    render(
      <div>
        <CopyableValue label="factory option" text="53B Trailer Tow Package" />
        <span>Private customer text that must not be copied</span>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy factory option: 53B Trailer Tow Package" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Could not copy factory option");
    });
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
  });
});
