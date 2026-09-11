import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/* A POS must never show a blank screen mid-shift. If a render throws, the
   cashier gets a readable message and a way back rather than a white page. */

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-full grid place-items-center p-6 bg-bg">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-danger-bg text-danger grid place-items-center mx-auto mb-4">
            <AlertTriangle size={26} />
          </div>
          <h1 className="text-[18px] font-extrabold text-ink">Something went wrong</h1>
          <p className="text-[14px] text-ink-2 mt-2 leading-relaxed">
            Your bills and products are safe on this device. Reload to carry on.
          </p>
          <pre className="mt-4 p-3 rounded-xl bg-surface-2 border border-line text-[11.5px] text-ink-3 text-left overflow-auto max-h-40">
            {error.message}
          </pre>
          <div className="flex gap-2.5 mt-5">
            <button
              onClick={() => this.setState({ error: null })}
              className="flex-1 h-11 rounded-xl bg-surface-3 text-ink font-semibold"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex-1 h-11 rounded-xl bg-accent text-accent-fg font-semibold"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
