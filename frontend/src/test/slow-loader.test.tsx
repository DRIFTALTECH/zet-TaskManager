/**
 * A loader for slow work, and silence for fast work.
 *
 * Setting an assignee sends a request and nothing on screen said so: the value
 * simply did not change for as long as it took, which reads as a click that
 * missed — so people click again. But a spinner that appears and vanishes
 * inside 100ms reads as a glitch, not as progress, so it waits first.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useSlowFlag } from '@/hooks/useSlowFlag';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSlowFlag', () => {
  it('says nothing while the work is still young', () => {
    const { result } = renderHook(() => useSlowFlag(true, 350));
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(false);
  });

  it('speaks up once the wait is long enough to notice', () => {
    const { result } = renderHook(() => useSlowFlag(true, 350));
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(true);
  });

  it('never fires for work that finished quickly', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useSlowFlag(active, 350),
      { initialProps: { active: true } },
    );
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ active: false });          // came back fast
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(false);
  });

  it('goes quiet again when the work ends', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useSlowFlag(active, 350),
      { initialProps: { active: true } },
    );
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it('starts silent when nothing is happening', () => {
    const { result } = renderHook(() => useSlowFlag(false, 350));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(false);
  });
});
