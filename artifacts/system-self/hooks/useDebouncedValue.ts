import { useEffect, useState } from "react";

/** `value`, updated only once it has stayed the same for `ms` milliseconds (typing settles before a request). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
