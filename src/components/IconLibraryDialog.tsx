import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BRAND_ICONS } from "@/lib/brandIcons";
import {
  brandMatches,
  englishQuery,
  genericIconUrl,
  searchGenericIcons,
} from "@/lib/iconSearch";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** data URL du SVG choisi, prête à stocker en favicon */
  onPick: (dataUrl: string) => void;
}

type Tab = "brands" | "generic";
type BrandTone = "brand" | "white" | "black";
type GenericTone = "dark" | "light";

const BRAND_TONES: { id: BrandTone; label: string; hint: string }[] = [
  { id: "brand", label: "Couleur", hint: "couleurs officielles" },
  { id: "white", label: "Blanc", hint: "lisible en thème sombre" },
  { id: "black", label: "Noir", hint: "lisible en thème clair" },
];

const GENERIC_TONES: { id: GenericTone; label: string; hex: string }[] = [
  { id: "dark", label: "Sombres", hex: "18181b" },
  { id: "light", label: "Claires", hex: "ffffff" },
];

/** Sélection d'accueil (flemme zéro) : apps courantes, dans cet ordre. */
const POPULAR = [
  "googlechrome",
  "firefox",
  "brave",
  "gmail",
  "youtube",
  "github",
  "gitlab",
  "vscodium",
  "cursor",
  "sublimetext",
  "notepadplusplus",
  "docker",
  "discord",
  "spotify",
  "notion",
  "figma",
  "stackoverflow",
  "reddit",
  "twitch",
  "netflix",
  "steam",
  "vlcmediaplayer",
  "bitwarden",
  "thunderbird",
  "homeassistant",
  "jellyfin",
  "pihole",
  "adguard",
  "nextcloud",
  "syncthing",
  "tailscale",
  "kubernetes",
  "python",
  "rust",
  "typescript",
  "nodedotjs",
  "googledrive",
  "dropbox",
  "whatsapp",
  "telegram",
  "neovim",
  "zoom",
];

/** Idées de recherche pour l'onglet générique (un clic = recherché). */
const GENERIC_IDEAS = [
  "music",
  "book",
  "game",
  "photo",
  "food",
  "travel",
  "sport",
  "money",
  "home",
  "work",
  "heart",
  "star",
];

function brandIconUrl(slug: string, tone: BrandTone): string {
  if (tone === "white") return `https://cdn.simpleicons.org/${slug}/ffffff`;
  if (tone === "black") return `https://cdn.simpleicons.org/${slug}/000000`;
  return `https://cdn.simpleicons.org/${slug}`;
}

const PAGE_SIZE = 48;
const FETCH_LIMIT = 192;

/** Barre de pagination : fixe, sous la grille (zéro scroll). */
function PageBar({
  page,
  pages,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {pages > 1 && (
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={onPrev}
          title="Page précédente"
        >
          <ChevronLeft />
          Précédent
        </Button>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        {pages > 1 ? `Page ${page + 1}/${pages} · ` : ""}
        {total} résultat{total > 1 ? "s" : ""}
      </span>
      {pages > 1 && (
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages - 1}
          onClick={onNext}
          title="Page suivante"
        >
          Suivant
          <ChevronRight />
        </Button>
      )}
    </div>
  );
}

export function IconLibraryDialog({ open, onOpenChange, onPick }: Props) {
  const [tab, setTab] = useState<Tab>("brands");
  const [query, setQuery] = useState("");
  const [brandTone, setBrandTone] = useState<BrandTone>("brand");
  // ton par défaut selon le thème actuel (icônes claires en mode sombre…)
  const [genericTone, setGenericTone] = useState<GenericTone>(() =>
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
      ? "light"
      : "dark",
  );
  const [picking, setPicking] = useState<string | null>(null);
  // pagination : page courante, remise à zéro à chaque recherche / onglet
  const [page, setPage] = useState(0);
  // slugs dont l'aperçu CDN a échoué (snapshot dérivé) : masqués
  const [dead, setDead] = useState<Set<string>>(new Set());

  // recherche distante anti-rebond (350 ms)
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const brandResults = useMemo(() => {
    const q = query.trim();
    const list = !q
      ? POPULAR.map((slug) => BRAND_ICONS.find((b) => b.slug === slug)).filter(
          (b): b is (typeof BRAND_ICONS)[number] => !!b,
        )
      : BRAND_ICONS.filter((b) => brandMatches(b.title, b.slug, q));
    return list.filter((b) => !dead.has(b.slug));
  }, [query, dead]);
  const brandPages = Math.max(1, Math.ceil(brandResults.length / PAGE_SIZE));
  const brandPage = Math.min(page, brandPages - 1);
  const brandPaged = brandResults.slice(
    brandPage * PAGE_SIZE,
    brandPage * PAGE_SIZE + PAGE_SIZE,
  );

  const genericQuery = englishQuery(debounced);
  const {
    data: genericIds,
    isFetching: genericBusy,
    isError: genericError,
  } = useQuery({
    queryKey: ["iconify", "search", genericQuery],
    queryFn: () => searchGenericIcons(genericQuery, FETCH_LIMIT),
    enabled: tab === "generic" && genericQuery.length >= 2,
    staleTime: 300_000,
  });
  const genericList = useMemo(
    () => (genericIds ?? []).filter((id) => !dead.has(id)),
    [genericIds, dead],
  );
  const genericPages = Math.max(1, Math.ceil(genericList.length / PAGE_SIZE));
  const genericPage = Math.min(page, genericPages - 1);
  const genericPaged = genericList.slice(
    genericPage * PAGE_SIZE,
    genericPage * PAGE_SIZE + PAGE_SIZE,
  );
  const genericHex =
    GENERIC_TONES.find((t) => t.id === genericTone)?.hex ?? "18181b";

  async function pick(svgUrl: string, key: string) {
    setPicking(key);
    try {
      const res = await fetch(svgUrl);
      if (!res.ok) throw new Error("Icône indisponible pour le moment");
      const svg = await res.text();
      if (!svg.includes("<svg")) throw new Error("Icône indisponible");
      onPick(`data:image/svg+xml,${encodeURIComponent(svg)}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(null);
    }
  }

  function markDead(slug: string) {
    setDead((prev) => new Set(prev).add(slug));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bibliothèque d'icônes</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {tab === "brands"
              ? `${BRAND_ICONS.length.toLocaleString("fr-FR")} logos d'apps et de marques — un clic et c'est appliqué.`
              : "200 000+ icônes génériques (Lucide, Material, Tabler…) — un clic et c'est appliqué."}
          </p>
        </DialogHeader>
        <div className="grid gap-3">
          {/* onglets Marques / Génériques */}
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: "brands", label: "Apps & marques" },
                { id: "generic", label: "Génériques" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setPage(0);
                }}
                aria-pressed={tab === t.id}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  tab === t.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              placeholder={
                tab === "brands"
                  ? "Rechercher un logo (ex : youtube, vscode, banque…)"
                  : "Rechercher une icône (ex : musique, livre, game…)"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              className="pl-8"
            />
          </div>

          {/* tons */}
          <div className="flex items-center gap-1.5">
            {(tab === "brands" ? BRAND_TONES : GENERIC_TONES).map((t) => {
              const active =
                tab === "brands" ? brandTone === t.id : genericTone === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() =>
                    tab === "brands"
                      ? setBrandTone(t.id as BrandTone)
                      : setGenericTone(t.id as GenericTone)
                  }
                  title={"hint" in t ? t.hint : t.label}
                  aria-pressed={active}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* CDN injoignable : la grille semblerait « vide » sinon */}
          {dead.size >= 12 && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <WifiOff className="size-4 shrink-0" />
              Les aperçus ne chargent pas — vérifie ta connexion Internet (les
              visuels viennent d'un CDN).
            </p>
          )}

          {tab === "brands" ? (
            brandResults.length > 0 ? (
              <>
                <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                  {brandPaged.map((b) => (
                    <button
                      key={b.slug}
                      type="button"
                      onClick={() =>
                        void pick(brandIconUrl(b.slug, brandTone), b.slug)
                      }
                      disabled={picking !== null}
                      title={b.title}
                      className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-transparent p-2 transition-all outline-none hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                    >
                      {picking === b.slug ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <img
                          src={brandIconUrl(b.slug, brandTone)}
                          alt={b.title}
                          loading="lazy"
                          className="size-full object-contain"
                          onError={() => markDead(b.slug)}
                        />
                      )}
                    </button>
                  ))}
                </div>
                <PageBar
                  page={brandPage}
                  pages={brandPages}
                  total={brandResults.length}
                  onPrev={() => setPage((p) => p - 1)}
                  onNext={() => setPage((p) => p + 1)}
                />
              </>
            ) : (
              <div className="grid justify-items-center gap-2 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Aucun logo pour « {query.trim()} » ici — les marques retirées
                  de Simple Icons (Adobe, OpenAI…) restent trouvables dans
                  Génériques.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTab("generic");
                    setPage(0);
                  }}
                >
                  Chercher dans Génériques
                </Button>
              </div>
            )
          ) : genericQuery.length < 2 ? (
            /* idées de recherche pour démarrer */
            <div className="flex flex-wrap gap-1.5">
              {GENERIC_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    setQuery(idea);
                    setPage(0);
                  }}
                  className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors outline-none hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {idea}
                </button>
              ))}
            </div>
          ) : genericBusy && !genericIds ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Recherche en cours…
            </div>
          ) : genericError ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Recherche indisponible — vérifie ta connexion puis réessaie.
            </p>
          ) : genericList.length > 0 ? (
            <>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
                {genericPaged.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      void pick(genericIconUrl(id, genericHex), id)
                    }
                    disabled={picking !== null}
                    title={id}
                    className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-transparent p-2 transition-all outline-none hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                  >
                    {picking === id ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <img
                        src={genericIconUrl(id, genericHex)}
                        alt={id}
                        loading="lazy"
                        className="size-full object-contain"
                        onError={() => markDead(id)}
                      />
                    )}
                  </button>
                ))}
              </div>
              <PageBar
                page={genericPage}
                pages={genericPages}
                total={genericList.length}
                onPrev={() => setPage((p) => p - 1)}
                onNext={() => setPage((p) => p + 1)}
              />
            </>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Aucune icône pour « {debounced.trim()} » — essaie un mot plus
              simple, en anglais.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {tab === "brands"
              ? "Tape un nom pour explorer les 3459 logos, 48 par page (la recherche comprend le français). Nécessite Internet (CDN Simple Icons)."
              : "Recherche en ligne (API Iconify, 48 par page). Nécessite Internet."}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
