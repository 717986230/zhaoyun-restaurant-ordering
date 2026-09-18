import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** Keeps a crash in one admin panel from blanking the whole console. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Admin console crashed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <div className="admin-crash">
      <h1>管理台出错了</h1>
      <p>请重新载入页面；如果反复出现，请把下面的信息发给维护人员。</p>
      <button className="primary-action" onClick={() => window.location.reload()}>重新载入</button>
      <pre>{this.state.error.message}</pre>
    </div>;
  }
}
