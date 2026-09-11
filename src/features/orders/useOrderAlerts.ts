import { useEffect, useRef, useState } from 'react';
import { useOrderIntake } from './useOrderIntake';
import { useAppStore } from '@/store/useAppStore';
import type { CloudOrder } from '@/types/order';

/* Deciding what counts as NEW is the whole job here, and it is pure, so it is
   tested directly. The chime, the badge and the banner all hang off it. */

export function newlyArrived(
  previous: CloudOrder[] | null,
  current: CloudOrder[],
): CloudOrder[] {
  // The first load is not an event. A till opening in the morning must not
  // chime once for every order still on the board from last night.
  if (previous === null) return [];
  const known = new Set(previous.map((o) => o.id));
  return current.filter((o) => o.status === 'PAID' && !known.has(o.id));
}

/** A short chime built with WebAudio — no asset to bundle, works offline. */
function playChime(): void {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    for (const [freq, at] of [[880, 0], [1320, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.3);
    }
    setTimeout(() => void ctx.close(), 900);
  } catch {
    // A till with audio blocked still gets the badge and the banner.
  }
}

export function useOrderAlerts() {
  const { orders } = useOrderIntake(true);
  const soundOn = useAppStore((s) => s.settings.notifications.onlineOrderAlert);

  const previous = useRef<CloudOrder[] | null>(null);
  const [unseen, setUnseen] = useState<string[]>([]);
  const [banner, setBanner] = useState<CloudOrder | null>(null);

  useEffect(() => {
    const arrived = newlyArrived(previous.current, orders);
    previous.current = orders;
    if (!arrived.length) return;

    setUnseen((u) => [...u, ...arrived.map((o) => o.id).filter((id) => !u.includes(id))]);
    setBanner(arrived[arrived.length - 1]);
    if (soundOn) playChime();
  }, [orders, soundOn]);

  /* An order that has been served stops counting, even if nobody opened it.
     Derived during render rather than filtered in an effect: the stored list
     can safely hold ids that are no longer live, because what the badge shows
     is this intersection. Doing it in an effect would be a synchronous
     setState and an extra render pass for no gain. */
  const liveUnseen = unseen.filter((id) => orders.some((o) => o.id === id));

  const markSeen = () => { setUnseen([]); setBanner(null); };

  return {
    orders,
    unseen: liveUnseen.length,
    banner,
    dismissBanner: () => setBanner(null),
    markSeen,
  };
}
