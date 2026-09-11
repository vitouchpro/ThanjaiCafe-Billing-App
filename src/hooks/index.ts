import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { can } from '@/features/auth/permissions';
import type { AccentName, Permission, ThemeMode } from '@/types';

/* ---------- Permissions ---------- */

export function usePermission(permission: Permission): boolean {
  const user = useAppStore((s) => s.currentUser);
  return can(user, permission);
}

export const useCurrentUser = () => useAppStore((s) => s.currentUser);

/* ---------- Theme ---------- */

const ACCENTS: Record<Exclude<AccentName, 'custom'>, { hue: number; sat: number }> = {
  coffee: { hue: 24, sat: 52 },
  green: { hue: 152, sat: 44 },
  orange: { hue: 18, sat: 78 },
};

/** Applies theme + accent to the document root. Accent is written as HSL
    channels so every token derived from it shifts together. */
export function useTheme() {
  const theme = useAppStore((s) => s.settings.appearance.theme);
  const accent = useAppStore((s) => s.settings.appearance.accent);
  const customHue = useAppStore((s) => s.settings.appearance.customAccentHue);
  const cardStyle = useAppStore((s) => s.settings.appearance.cardStyle);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const isDark = theme === 'dark' || (theme === 'system' && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);

    const { hue, sat } = accent === 'custom' ? { hue: customHue, sat: 58 } : ACCENTS[accent];
    const set = (k: string, v: string) => root.style.setProperty(k, v);

    if (isDark) {
      set('--accent-50', `${hue} 20% 18%`);
      set('--accent-100', `${hue} 24% 24%`);
      set('--accent-300', `${hue} ${sat - 10}% 52%`);
      set('--accent-500', `${hue} ${sat + 10}% 56%`);
      set('--accent-600', `${hue} ${sat + 6}% 48%`);
      set('--accent-700', `${hue} ${sat}% 40%`);
      set('--accent-fg', `${hue} 40% 10%`);
    } else {
      set('--accent-50', `${hue} 46% 96%`);
      set('--accent-100', `${hue} 44% 90%`);
      set('--accent-300', `${hue} 40% 66%`);
      set('--accent-500', `${hue} ${sat}% 38%`);
      set('--accent-600', `${hue} ${sat + 4}% 32%`);
      set('--accent-700', `${hue} ${sat + 6}% 25%`);
      set('--accent-fg', `${hue} 60% 97%`);
    }

    document.body.classList.toggle('density-compact', cardStyle === 'compact');
    document.body.classList.toggle('density-comfortable', cardStyle !== 'compact');
  }, [isDark, accent, customHue, cardStyle]);

  return { isDark, theme: theme as ThemeMode };
}

/* ---------- Online / offline (Plan §32) ---------- */

export function useOnlineStatus() {
  const online = useAppStore((s) => s.online);
  const setOnline = useAppStore((s) => s.setOnline);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [setOnline]);

  const pendingSync = useAppStore((s) => s.bills.filter((b) => b.synced === 0).length);
  return { online, pendingSync };
}

/* ---------- Responsive ---------- */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
export const useIsTablet = () => useMediaQuery('(min-width: 768px) and (max-width: 1279px)');
export const useIsDesktop = () => useMediaQuery('(min-width: 1280px)');

/* ---------- Utility hooks ---------- */

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Global shortcut binding. Ignores keystrokes typed into inputs so the
    cashier can still type a customer name containing "n". (Plan §28) */
export function useHotkeys(
  map: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
) {
  // The handler map is stashed in a ref so the listener is bound once, but the
  // write happens in an effect — assigning during render is unsafe under
  // concurrent rendering.
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('ctrl');
      if (e.shiftKey) parts.push('shift');
      if (e.altKey) parts.push('alt');
      parts.push(e.key.toLowerCase());
      const combo = parts.join('+');

      const fn = ref.current[combo];
      if (!fn) return;
      // Bare keys never fire while typing; chorded ones still work.
      if (typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Escape') return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* private mode — fall back to in-memory only */
      }
    },
    [key],
  );
  return [value, set];
}

/** Locks body scroll while a modal or sheet is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

export function useProductIndex() {
  const products = useAppStore((s) => s.products);
  return useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
}

export function useCategoryIndex() {
  const categories = useAppStore((s) => s.categories);
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}
