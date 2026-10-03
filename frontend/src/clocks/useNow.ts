/**
 * Epic 48 (AD-64): the current instant, re-rendered on each minute boundary (not every 60s
 * from mount, which would show 14:05 until 14:05:59 + mount offset). SKELETON: builder T
 * implements; `offsetMinutes` is the slider's shift, added to the real now.
 */
export function useNow(_offsetMinutes = 0): Date {
  return new Date();
}
