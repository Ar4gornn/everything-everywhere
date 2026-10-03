import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow";

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:30Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the real now plus the offset", () => {
    const { result } = renderHook(() => useNow(90));
    expect(result.current.toISOString()).toBe("2026-03-20T13:30:30.000Z");
  });

  it("ticks on the minute boundary, not 60s after mount", () => {
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe("2026-03-20T12:00:30.000Z");
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(result.current.toISOString()).toBe("2026-03-20T12:00:30.000Z");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.toISOString()).toBe("2026-03-20T12:01:00.000Z");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe("2026-03-20T12:02:00.000Z");
  });

  it("follows a changed offset without waiting", () => {
    const { result, rerender } = renderHook(({ o }) => useNow(o), { initialProps: { o: 0 } });
    rerender({ o: -60 });
    expect(result.current.toISOString()).toBe("2026-03-20T11:00:30.000Z");
  });

  it("clears its timer on unmount", () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
