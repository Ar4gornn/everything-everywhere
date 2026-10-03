/**
 * Epic 48 (AD-64): the current instant, re-rendered on each minute boundary (not every 60s
 * from mount, which would show 14:05 until 14:05:59 + mount offset). `offsetMinutes` is the
 * slider's shift, added to the real now.
 */
import { useEffect, useMemo, useState } from "react";

export function useNow(offsetMinutes = 0): Date {
  const [real, setReal] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setReal(Date.now());
        arm();
      }, 60000 - (Date.now() % 60000));
    };
    arm();
    return () => clearTimeout(timer);
  }, []);

  return useMemo(() => new Date(real + offsetMinutes * 60000), [real, offsetMinutes]);
}
