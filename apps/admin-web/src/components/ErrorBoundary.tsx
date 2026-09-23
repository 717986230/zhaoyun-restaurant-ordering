import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { initialAdminLanguage, translate } from "../app/i18n";

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
    // A class component cannot read the language context, and whatever broke
    // may have been the context itself, so it asks storage directly.
    const language = initialAdminLanguage();
    return <div className="admin-crash">
      <h1>{translate(language, "crashTitle")}</h1>
      <p>{translate(language, "crashBody")}</p>
      <button className="primary-action" onClick={() => window.location.reload()}>{translate(language, "reload")}</button>
      <pre>{this.state.error.message}</pre>
    </div>;
  }
}
