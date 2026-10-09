import { useEffect, useRef } from "react";
import { formatMs, useCountdown } from "../hooks/useCountdown";

const HOLD_MS = 5 * 60_000;

interface Props {
  expiresAt: number; // epoch ms, from the server
  clockOffset: number;
  onExpire: () => void;
}

// Shows the 5-minute hold and tells the parent exactly once when it runs out.
export function ReservationTimer({ expiresAt, clockOffset, onExpire }: Props) {
  const ms = useCountdown(expiresAt, clockOffset);
  const fired = useRef(false);

  useEffect(() => {
    if (ms === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [ms, onExpire]);

  const pct = Math.min(100, (ms / HOLD_MS) * 100);

  return (
    <div className={`timer ${ms < 60_000 ? "urgent" : ""}`}>
      <p role="timer" aria-live="off">
        Reserved for you: <strong>{formatMs(ms)}</strong>
      </p>
      <div className="bar" aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
