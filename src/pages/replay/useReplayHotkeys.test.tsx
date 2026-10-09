import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useReplayHotkeys } from "./useReplayHotkeys.ts";

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const ev = new KeyboardEvent("keydown", { key, shiftKey: true, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe("useReplayHotkeys", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("steps on Shift+Right and toggles play on Shift+Down", () => {
    const onStep = vi.fn();
    const onTogglePlay = vi.fn();
    renderHook(() => useReplayHotkeys({ onStep, onTogglePlay }));
    press("ArrowRight");
    press("ArrowDown");
    vi.runAllTimers();
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("ignores keys without Shift, while typing, or already handled", () => {
    const onStep = vi.fn();
    renderHook(() => useReplayHotkeys({ onStep, onTogglePlay: vi.fn() }));
    press("ArrowRight", { shiftKey: false });
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("ArrowRight", {}, input);
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    vi.runAllTimers();
    expect(onStep).not.toHaveBeenCalled();
    input.remove();
  });

  it("lets a later listener claim the key by calling preventDefault", () => {
    const onStep = vi.fn();
    renderHook(() => useReplayHotkeys({ onStep, onTogglePlay: vi.fn() }));
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", claim);
    press("ArrowRight");
    vi.runAllTimers();
    window.removeEventListener("keydown", claim);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", () => {
    const onStep = vi.fn();
    const { unmount } = renderHook(() => useReplayHotkeys({ onStep, onTogglePlay: vi.fn() }));
    unmount();
    press("ArrowRight");
    vi.runAllTimers();
    expect(onStep).not.toHaveBeenCalled();
  });
});
