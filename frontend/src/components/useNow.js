import { useEffect, useState } from 'react';

// Current time that re-renders every `intervalMs` while `active` (for live running timers)
export default function useNow(active = true, intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

export const totalMs = (task, now) =>
  task.logged_seconds * 1000 + (task.running_since ? Math.max(0, now - new Date(task.running_since).getTime()) : 0);
