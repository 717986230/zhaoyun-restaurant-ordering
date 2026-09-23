import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

const lastErrorKey = "zy_last_client_error";

/**
 * The guest tablet runs unattended in kiosk mode, so an unhandled render error
 * would otherwise leave a white screen nobody in the room can recover from.
 * The fallback is deliberately trilingual and state-free: whatever corrupted
 * the app must not be needed to draw it.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Customer app crashed", error, info.componentStack);
    try {
      localStorage.setItem(lastErrorKey, JSON.stringify({
        message: error.message,
        stack: String(error.stack ?? "").slice(0, 2000),
        at: new Date().toISOString()
      }));
    } catch {
      /* Storage is full or blocked; the on-screen message still works. */
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <section className="crash">
      <h1>赵云</h1>
      <p>菜单出了问题，请叫服务员</p>
      <p>Es ist ein Fehler aufgetreten. Bitte rufen Sie das Personal.</p>
      <p>Something went wrong. Please call our staff.</p>
      <button className="primary" onClick={() => window.location.reload()}>重新载入 · Neu laden · Reload</button>
      <code>{this.state.error.message}</code>
    </section>;
  }
}
