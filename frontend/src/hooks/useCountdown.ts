import { useEffect, useState } from "react";

// Milliseconds left until `target` (epoch ms), ticking every second.
// `clockOffset` = serverNow - clientNow, so a wrong device clock cannot
// stretch or shrink the countdown. Returns 0 once expired.
export function useCountdown(target: number | null, clockOffset = 0) {
  const remaining = () =>
    target === null ? 0 : Math.max(target - (Date.now() + clockOffset), 0);

  const [ms, setMs] = useState(remaining);

  useEffect(() => {
    setMs(remaining());
    if (target === null) return;

    const id = setInterval(() => {
      const left = remaining();
      setMs(left);
      if (left === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, clockOffset]);

  return ms;
}

export function formatMs(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}
