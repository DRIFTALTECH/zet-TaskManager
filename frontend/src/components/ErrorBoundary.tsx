import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows what failed, e.g. "Timesheet". */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so one bad row of data cannot blank the whole app.
 *
 * Without this, React unmounts the entire tree on an uncaught render error and
 * the user is left staring at a white screen with no message and no way back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sentry's global handler picks this up when SENTRY_DSN is configured.
    console.error('Render error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
          <h2 className="mt-3 text-base font-semibold">
            {this.props.area ? `${this.props.area} could not load` : 'Something broke here'}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The rest of the app is still working. Try again, and if it keeps happening,
            send this message to your admin:
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-muted p-2.5 text-left text-xs text-muted-foreground">
            {error.message || String(error)}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={this.reset}>
              <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
            </Button>
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
