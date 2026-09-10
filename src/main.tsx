import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useI18n } from "@/lib/i18n";
import { applyAppearance, readAppearance } from "./lib/appearance";

// Application immédiate (avant le premier rendu) pour éviter tout flash du
// style par défaut quand l'utilisateur a personnalisé l'interface.
applyAppearance(readAppearance());

// Thème sombre natif : forcé avant le premier rendu (aucun flash clair),
// sans interrupteur. Les déclinaisons `.dark` du CSS s'appliquent partout.
document.documentElement.classList.add("dark");
localStorage.removeItem("vaultly-theme");

/** Un crash de render sinon = écran blanc sans recours : on affiche au
 *  moins un message avec bouton de rechargement. */
function ErrorFallback({ error }: { error: Error }) {
  const { t } = useI18n();
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">
      <p className="font-semibold">{t("Vaultly a rencontré une erreur")}</p>
      <p className="max-w-md text-sm text-muted-foreground">{String(error)}</p>
      <button
        type="button"
        className="cursor-pointer rounded-lg border bg-card px-4 py-2 text-sm hover:bg-accent"
        onClick={() => window.location.reload()}
      >
        {t("Recharger l'interface")}
      </button>
    </div>
  );
}

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
      return <ErrorFallback error={this.state.error} />;
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
