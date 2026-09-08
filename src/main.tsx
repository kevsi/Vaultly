import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/** Un crash de render sinon = écran blanc sans recours : on affiche au
 *  moins un message avec bouton de rechargement. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
          <p className="font-semibold">Vaultly a rencontré une erreur</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {String(this.state.error)}
          </p>
          <button
            className="cursor-pointer rounded-lg border bg-card px-4 py-2 text-sm hover:bg-accent"
            onClick={() => window.location.reload()}
          >
            Recharger l'interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
