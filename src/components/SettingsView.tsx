import {
  ExternalLink,
  Heart,
  Link2Off,
  Palette,
  Plug,
  Puzzle,
  Rocket,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { AiSection } from "@/components/settings/AiSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { BackupSection } from "@/components/settings/BackupSection";
import { ExtensionSection } from "@/components/settings/ExtensionSection";
import { GeneralSection } from "@/components/settings/GeneralSection";
import { LinksSection } from "@/components/settings/LinksSection";
import { OpenersSection } from "@/components/settings/OpenersSection";
import { SupportSection } from "@/components/settings/SupportSection";
import { UpdateSection } from "@/components/settings/UpdateSection";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Rubriques de la page Réglages : la sidebar remplace le long scroll unique.
const SECTIONS = [
  { id: "apparence", label: "Apparence", icon: Palette },
  { id: "ia", label: "Assistants IA", icon: Plug },
  { id: "extension", label: "Extension", icon: Puzzle },
  { id: "links", label: "Liens morts", icon: Link2Off },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "ouverture", label: "Ouverture", icon: ExternalLink },
  { id: "backup", label: "Sauvegarde", icon: Save },
  { id: "maj", label: "Mise à jour", icon: Rocket },
  { id: "soutenir", label: "Soutenir", icon: Heart },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const [section, setSection] = useState<SectionId>(() => {
    const stored = localStorage.getItem("vaultly-settings-section");
    return SECTIONS.some((s) => s.id === stored) ? (stored as SectionId) : "ia";
  });
  function pickSection(id: SectionId) {
    setSection(id);
    localStorage.setItem("vaultly-settings-section", id);
  }
  // rubrique « Liens morts » visitée : la pastille tombe (revérifiée auto
  // toutes les 6 h si les liens restent morts)
  useEffect(() => {
    if (section === "links") {
      window.dispatchEvent(new CustomEvent("vaultly:deadlinks-seen"));
    }
  }, [section]);

  const { t } = useI18n();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  return (
    <div className="flex h-full min-h-0">
      {/* sidebar des rubriques */}
      <aside className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-card/40 p-3">
        <h2 className="px-2 pb-2 pt-1 text-sm font-semibold">
          {t("settings")}
        </h2>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pickSection(s.id)}
            aria-current={section === s.id ? "page" : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
              section === s.id
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <s.icon className="size-4 shrink-0" />
            {t(s.label)}
          </button>
        ))}
      </aside>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          {section === "apparence" && <AppearanceSection />}

          {section === "ia" && <AiSection setConfirm={setConfirm} />}

          {section === "general" && <GeneralSection />}

          {section === "ouverture" && <OpenersSection />}

          {section === "links" && <LinksSection />}

          {section === "extension" && (
            <ExtensionSection setConfirm={setConfirm} />
          )}

          {section === "backup" && <BackupSection />}

          {section === "maj" && <UpdateSection setConfirm={setConfirm} />}

          {section === "soutenir" && <SupportSection />}
        </div>
      </ScrollArea>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
