import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Delete, LogIn } from 'lucide-react';
import clsx from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { Card, toast } from '@/components/ui';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, landingRoute } from '@/features/auth/permissions';
import { formatDate, formatDayName } from '@/utils/date';

/* PIN sign-in. A counter tablet is shared between staff, so switching user
   has to be a two-second action, not a password form. */

export function LoginPage() {
  // Select the raw array — a .filter() inside the selector returns a new
  // reference every render and sends useSyncExternalStore into a loop.
  const allUsers = useAppStore((s) => s.users);
  const users = useMemo(() => allUsers.filter((u) => u.active), [allUsers]);
  const business = useAppStore((s) => s.settings.business);
  const login = useAppStore((s) => s.login);
  const navigate = useNavigate();

  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const user = users.find((u) => u.id === selected);

  async function submit(value: string) {
    if (!selected) return;
    const ok = await login(selected, value);
    if (ok) {
      const u = users.find((x) => x.id === selected)!;
      toast(`Welcome back, ${u.name.split(' ')[0]}`, 'success');
      navigate(landingRoute(u), { replace: true });
    } else {
      setError(true);
      setPin('');
      setTimeout(() => setError(false), 600);
    }
  }

  function press(digit: string) {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) setTimeout(() => void submit(next), 120);
  }

  return (
    <div className="min-h-full grid place-items-center p-4 bg-bg">
      <div className="w-full max-w-md">
        <div className="text-center mb-7">
          <div className="w-16 h-16 rounded-3xl bg-accent grid place-items-center text-accent-fg mx-auto mb-4 shadow-[var(--shadow-md)] overflow-hidden">
            {business.logo
              ? <img src={business.logo} alt="" className="w-full h-full object-cover" />
              : <Coffee size={30} />}
          </div>
          <h1 className="text-[22px] font-extrabold text-ink">{business.name}</h1>
          <p className="text-[13.5px] text-ink-3 mt-1">
            {formatDayName(new Date())}, {formatDate(new Date())}
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          {!selected ? (
            <>
              <p className="text-[13px] font-bold text-ink-3 uppercase tracking-wider mb-3">
                Who is on the counter?
              </p>
              <div className="space-y-2">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelected(u.id); setPin(''); }}
                    className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-line bg-surface-2 hover:border-accent hover:bg-accent-50 transition text-left group"
                  >
                    <span className="w-11 h-11 rounded-xl bg-accent text-accent-fg grid place-items-center text-[16px] font-extrabold shrink-0">
                      {u.name[0].toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-ink truncate">{u.name}</span>
                      <span className="block text-[12.5px] text-ink-3">{ROLE_DESCRIPTIONS[u.role]}</span>
                    </span>
                    <LogIn size={17} className="text-ink-3 group-hover:text-accent shrink-0" />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-5">
                <span className="w-11 h-11 rounded-xl bg-accent text-accent-fg grid place-items-center text-[16px] font-extrabold">
                  {user!.name[0].toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-ink truncate">{user!.name}</p>
                  <p className="text-[12.5px] text-ink-3">{ROLE_LABELS[user!.role]}</p>
                </div>
                <button
                  onClick={() => { setSelected(null); setPin(''); }}
                  className="text-[13px] font-semibold text-accent hover:underline"
                >
                  Change
                </button>
              </div>

              <p className="text-center text-[13px] font-semibold text-ink-2 mb-3">Enter your 4-digit PIN</p>

              <div className={clsx('flex justify-center gap-3 mb-6', error && 'animate-pop')}>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={clsx(
                      'w-3.5 h-3.5 rounded-full transition-all',
                      error ? 'bg-danger scale-110' : i < pin.length ? 'bg-accent scale-110' : 'bg-line-strong/50',
                    )}
                  />
                ))}
              </div>

              {error && (
                <p className="text-center text-[13px] font-semibold text-danger mb-4">
                  That PIN is not right. Try again.
                </p>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <PinKey key={d} onClick={() => press(d)}>{d}</PinKey>
                ))}
                <div />
                <PinKey onClick={() => press('0')}>0</PinKey>
                <PinKey onClick={() => setPin(pin.slice(0, -1))} aria-label="Delete">
                  <Delete size={20} />
                </PinKey>
              </div>
            </>
          )}
        </Card>

        <p className="text-center text-[12px] text-ink-3 mt-5 leading-relaxed">
          Demo PINs — Owner <b>1234</b> · Manager <b>2345</b> · Cashier <b>3456</b>
          <br />
          Everything is stored on this device. Nothing leaves the counter.
        </p>
      </div>
    </div>
  );
}

function PinKey({
  children, onClick, ...rest
}: { children: React.ReactNode; onClick: () => void } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      className="h-14 rounded-xl bg-surface-2 border border-line text-[19px] font-bold text-ink hover:bg-surface-3 hover:border-line-strong active:scale-95 transition grid place-items-center"
      {...rest}
    >
      {children}
    </button>
  );
}
