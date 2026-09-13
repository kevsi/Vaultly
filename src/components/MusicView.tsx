import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  GripVertical,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  type DragEvent as ReactDragEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { PromptDialog } from "@/components/PromptDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  addPlaylistItems,
  audioEngineInstall,
  audioEngineInstalled,
  audioImportPlaylist,
  createPlaylist,
  deletePlaylist,
  listPlaylistItems,
  listPlaylists,
  listResources,
  removePlaylistItem,
  renamePlaylist,
  reorderPlaylistItems,
  updateResource,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  type PlayerTrack,
  playQueue,
  setPlaying,
  syncQueue,
  usePlayer,
} from "@/lib/playerStore";
import { hostOf } from "@/lib/resources";
import type { MusicPlaylist, Resource } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

/** Trois barres animées : la piste en cours se voit de loin. */
function EqBadge() {
  return (
    <span
      data-eq
      aria-hidden="true"
      className="flex h-3.5 shrink-0 items-end gap-[3px] rounded bg-background/70 px-1 py-[3px] shadow"
    >
      <span />
      <span />
      <span />
    </span>
  );
}

function track(r: {
  url: string;
  title: string;
  favicon?: string;
  cover?: string;
}): PlayerTrack {
  return {
    url: r.url,
    title: r.title || hostOf(r.url),
    cover: r.favicon ?? r.cover ?? "",
  };
}

/**
 * Section Musique : les vidéos de la bibliothèque en cartes vignettes,
 * drapeau ♫ « musique », playlists locales (pistes réordonnables au glisser)
 * et import de playlists YouTube plafonné — le tout connecté au lecteur
 * global (playerStore) avec enchaînement automatique des pistes.
 */
export function MusicView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const player = usePlayer();
  const [selected, setSelected] = useState<number | null>(null);
  const [musicsOnly, setMusicsOnly] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [imp, setImp] = useState({ url: "", name: "", limit: "50" });
  const [addNew, setAddNew] = useState<PlayerTrack | "bare" | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const { data: playlists } = useQuery({
    queryKey: ["playlists"],
    queryFn: listPlaylists,
  });
  const { data: videos } = useQuery({
    queryKey: ["videos"],
    queryFn: () =>
      listResources({
        resourceType: "video",
        limit: 500,
        // les archivés sont des « terminés » : hors de la file musicale
        hideArchived: true,
      }),
  });
  const { data: items } = useQuery({
    queryKey: ["playlistItems", selected],
    queryFn: () => (selected === null ? [] : listPlaylistItems(selected)),
    enabled: selected !== null,
  });

  useEffect(() => {
    void audioEngineInstalled().then(setEngine);
  }, []);

  const lists = playlists ?? [];
  const allVideos = videos ?? [];
  const tracks = useMemo(
    () => allVideos.filter((r) => !musicsOnly || r.meta?.isSong === "1"),
    [allVideos, musicsOnly],
  );
  // file partagée par les cartes : UNE seule conversion, pas une par carte
  // (le .map dans le render coûtait O(n²) à chaque frame)
  const cardTracks = useMemo(() => tracks.map(track), [tracks]);
  const current = lists.find((p) => p.id === selected) ?? null;
  const playlistItems = items ?? [];
  const playlistTracks: PlayerTrack[] = playlistItems.map((it) => ({
    url: it.url,
    title: it.title || hostOf(it.url),
    cover: it.cover,
  }));

  // la playlist affichée alimente-t-elle le lecteur ? toute édition (retrait,
  // réordonnancement) resynchronise la file sans interrompre la piste.
  // items === undefined = chargement en cours : ne jamais couper la lecture
  // biome-ignore lint/correctness/useExhaustiveDependencies: syncQueue ignore de lui-même toute file qui ne provient pas de CETTE playlist (garde sourceKey)
  useEffect(() => {
    if (selected === null || !current || !items) return;
    syncQueue(`playlist:${selected}`, playlistTracks, current.name);
  }, [items, selected]);

  async function refreshLists() {
    void qc.invalidateQueries({ queryKey: ["playlists"] });
    void qc.invalidateQueries({ queryKey: ["playlistItems"] });
  }

  async function create(name: string): Promise<MusicPlaylist | null> {
    const n = name.trim();
    if (!n) return null;
    try {
      const pl = await createPlaylist(n);
      setSelected(pl.id);
      refreshLists();
      return pl;
    } catch (e) {
      toast.error(describeError(e));
      return null;
    }
  }

  async function addTo(
    playlistId: number,
    r: { url: string; title: string; favicon: string },
  ) {
    try {
      const added = await addPlaylistItems(playlistId, [
        { url: r.url, title: r.title, cover: r.favicon },
      ]);
      toast.success(
        added > 0
          ? t("Piste ajoutée à « {name} »", {
              name: lists.find((p) => p.id === playlistId)?.name ?? "",
            })
          : t("Cette piste est déjà dans la playlist."),
      );
      refreshLists();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function toggleSong(r: Resource) {
    const on = r.meta?.isSong === "1";
    try {
      await updateResource(r.id, {
        url: r.url,
        title: r.title,
        description: r.description,
        resourceType: r.resourceType,
        category: r.category,
        tags: r.tags,
        notes: r.notes,
        favicon: r.favicon,
        favorite: r.favorite,
        status: r.status,
        folderId: r.folderId,
        meta: { ...r.meta, isSong: on ? "" : "1" },
      });
      void qc.invalidateQueries({ queryKey: ["videos"] });
      void qc.invalidateQueries({ queryKey: ["resources"] });
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  function reorderPlaylistTracks(
    from: number,
    target: number,
    clearDrag = false,
  ) {
    if (!items || selected === null) return;
    if (from === -1) {
      if (clearDrag) setDragFrom(null);
      refreshLists();
      return;
    }
    if (from === target || !items[from]) {
      if (clearDrag) setDragFrom(null);
      return;
    }
    const arr = [...items];
    const [moved] = arr.splice(from, 1);
    if (!moved) {
      if (clearDrag) setDragFrom(null);
      refreshLists();
      return;
    }
    arr.splice(target, 0, moved);
    if (clearDrag) setDragFrom(null);
    // optimiste : l'ordre s'affiche tout de suite
    void qc.setQueryData(["playlistItems", selected], arr);
    void reorderPlaylistItems(
      selected,
      arr.map((i) => i.id),
    ).catch((e) => {
      toast.error(describeError(e));
      refreshLists();
    });
  }

  function dropReorder(target: number, e: ReactDragEvent<HTMLDivElement>) {
    // le cache peut avoir changé entre dragStart et drop (refetch, retrait)
    // : la source est retrouvée par id, pas par l'index mémorisé au dragstart
    const draggedId = Number(e.dataTransfer.getData("text/plain"));
    const from = Number.isFinite(draggedId)
      ? (items?.findIndex((it) => it.id === draggedId) ?? -1)
      : (dragFrom ?? -1);
    reorderPlaylistTracks(from, target, true);
  }

  async function doImport() {
    const url = imp.url.trim();
    if (!url) return;
    setImporting(true);
    try {
      const limit = Math.max(1, Math.min(200, Number(imp.limit) || 50));
      const found = await audioImportPlaylist(url, limit);
      const pl =
        (await create(imp.name || found[0]?.title || t("Playlist importée"))) ??
        null;
      if (!pl) {
        setImporting(false);
        return;
      }
      const added = await addPlaylistItems(
        pl.id,
        found.map((f) => ({ url: f.url, title: f.title, cover: f.cover })),
      );
      toast.success(
        t("{count} piste(s) importée(s) dans « {name} »", {
          count: added,
          name: pl.name,
        }),
      );
      setImp({ url: "", name: "", limit: imp.limit });
      setSelected(pl.id);
      refreshLists();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setImporting(false);
    }
  }

  async function installEngine() {
    setInstalling(true);
    try {
      const v = await audioEngineInstall();
      setEngine(true);
      toast.success(`${t("Moteur audio installé")} (${v})`);
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setInstalling(false);
    }
  }

  const playingUrl =
    player.sourceKey === `playlist:${selected}` ||
    player.sourceKey === "library"
      ? player.track?.url
      : undefined;

  // ───────────────────────────────────────────────────────────────────────
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex min-h-full w-full max-w-6xl gap-5 p-6">
        {/* colonne gauche : playlists + import */}
        <aside className="flex w-60 shrink-0 flex-col gap-1.5">
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("Playlists")}
            </p>
            <Button
              size="icon-sm"
              variant="ghost"
              title={t("Créer une playlist")}
              onClick={() => setAddNew("bare")}
            >
              <Plus />
            </Button>
          </div>
          {lists.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t("Aucune playlist — clique + pour en créer une.")}
            </p>
          )}
          {lists.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(p.id)}
              onKeyDown={(e) => {
                // Espace AUSSI (sinon scroll de page au clavier)
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(p.id);
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors outline-none",
                selected === p.id
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  selected === p.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted",
                )}
              >
                <ListMusic className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                {renaming?.id === p.id ? (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await renamePlaylist(p.id, renaming.name);
                        setRenaming(null);
                        refreshLists();
                      } catch (err) {
                        toast.error(describeError(err));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Input
                      autoFocus
                      value={renaming.name}
                      onChange={(e) =>
                        setRenaming({ id: p.id, name: e.target.value })
                      }
                      onBlur={() => setRenaming(null)}
                      className="h-6 px-1.5 text-sm"
                    />
                  </form>
                ) : (
                  <>
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-[11px] tabular-nums">
                      {p.count} {t("piste(s)")}
                    </p>
                  </>
                )}
              </div>
              {renaming?.id !== p.id && (
                <>
                  <button
                    type="button"
                    title={t("Renommer")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ id: p.id, name: p.name });
                    }}
                    className="hidden cursor-pointer rounded p-1 text-muted-foreground group-hover:block hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    title={t("Supprimer")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirm({
                        title: t("Supprimer la playlist « {name} » ?", {
                          name: p.name,
                        }),
                        message: t(
                          "Ses pistes disparaissent, jamais les ressources de la bibliothèque.",
                        ),
                        confirmLabel: t("Supprimer"),
                        destructive: true,
                        action: async () => {
                          try {
                            await deletePlaylist(p.id);
                            if (selected === p.id) setSelected(null);
                            refreshLists();
                          } catch (err) {
                            toast.error(describeError(err));
                          }
                        },
                      });
                    }}
                    className="hidden cursor-pointer rounded p-1 text-muted-foreground group-hover:block hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}

          {/* import de playlist web */}
          <div className="mt-3 space-y-1.5 rounded-xl border bg-card p-3">
            <p className="text-xs font-semibold">
              {t("Importer une playlist YouTube")}
            </p>
            {engine === false && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {t("Nécessite le moteur audio (≈ 18 Mo, officiel yt-dlp).")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={installing}
                  onClick={() => void installEngine()}
                >
                  {installing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  {t("Installer le moteur audio")}
                </Button>
              </>
            )}
            <div
              className={cn(
                "space-y-1.5",
                engine === false && "pointer-events-none opacity-50",
              )}
            >
              <Input
                value={imp.url}
                onChange={(e) => setImp((s) => ({ ...s, url: e.target.value }))}
                placeholder="https://youtube.com/playlist?list=…"
                className="h-7 text-xs"
              />
              <div className="flex gap-1.5">
                <Input
                  value={imp.name}
                  onChange={(e) =>
                    setImp((s) => ({ ...s, name: e.target.value }))
                  }
                  placeholder={t("Nom de la playlist")}
                  className="h-7 min-w-0 flex-1 text-xs"
                />
                <Input
                  value={imp.limit}
                  onChange={(e) =>
                    setImp((s) => ({ ...s, limit: e.target.value }))
                  }
                  type="number"
                  min={1}
                  max={200}
                  title={t("Morceaux max")}
                  className="h-7 w-16 text-xs tabular-nums"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={importing || engine !== true || !imp.url.trim()}
                onClick={() => void doImport()}
              >
                {importing ? <Loader2 className="animate-spin" /> : <Music2 />}
                {t("Importer")}
              </Button>
            </div>
          </div>
        </aside>

        {/* colonne principale */}
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          {current ? (
            <>
              {/* héro playlist */}
              <div className="relative overflow-hidden rounded-2xl border bg-card">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-transparent to-transparent" />
                <div className="relative flex items-end gap-4 p-5">
                  {current && playlistTracks[0]?.cover ? (
                    <img
                      src={playlistTracks[0].cover}
                      alt=""
                      className="size-28 shrink-0 rounded-xl object-cover shadow-xl"
                    />
                  ) : (
                    <span className="flex size-28 shrink-0 items-center justify-center rounded-xl bg-muted shadow-xl">
                      <ListMusic className="size-8 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1 pb-1">
                    <h2 className="truncate text-2xl font-bold">
                      {current.name}
                    </h2>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {playlistTracks.length} {t("piste(s)")}
                      {playlistTracks.length > 0 && (
                        <span className="text-[11px]">
                          {" · "}
                          {t("glisser pour réordonner")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pb-1">
                    <Button
                      size="sm"
                      onClick={() =>
                        playQueue(
                          playlistTracks,
                          0,
                          `playlist:${current.id}`,
                          current.name,
                        )
                      }
                      disabled={playlistTracks.length === 0}
                    >
                      <Play />
                      {t("Tout lire")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(null)}
                    >
                      <Plus />
                      {t("Ajouter des vidéos")}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setSelected(null)}
                      title={t("Retour aux vidéos")}
                    >
                      <X />
                    </Button>
                  </div>
                </div>
              </div>

              {!items && (
                <div role="status" className="space-y-1 py-2">
                  <p className="sr-only">{t("Lecture de la playlist…")}</p>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5"
                    >
                      <span className="size-10 shrink-0 animate-pulse rounded-lg bg-muted" />
                      <span className="h-4 w-48 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              )}
              {items && playlistTracks.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Playlist vide — ajoute des vidéos avec le bouton « + ».",
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelected(null)}
                  >
                    <Music2 />
                    {t("Parcourir les vidéos")}
                  </Button>
                </div>
              )}
              <div role="list" className="space-y-1">
                {playlistItems.map((it, idx) => {
                  const isCurrent =
                    playingUrl === it.url &&
                    player.sourceKey === `playlist:${current.id}`;
                  return (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={(e) => {
                        // setData obligatoire : sans lui, Firefox refuse
                        // de démarrer le drag (et Chrome l'ignore parfois)
                        e.dataTransfer.setData("text/plain", String(it.id));
                        e.dataTransfer.effectAllowed = "move";
                        setDragFrom(idx);
                      }}
                      onDragEnd={() => setDragFrom(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => dropReorder(idx, e)}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors",
                        isCurrent
                          ? "bg-primary/10 ring-1 ring-primary/40"
                          : "hover:bg-accent/60",
                        dragFrom === idx && "opacity-40",
                      )}
                    >
                      <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" />
                      {isCurrent && player.playing ? (
                        <EqBadge />
                      ) : (
                        <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                          {idx + 1}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          // re-cliquer la piste en cours = pause/lecture
                          // (avant : no-op, l'utilisateur pensait que c'était cassé)
                          if (isCurrent) {
                            setPlaying(!player.playing);
                            return;
                          }
                          playQueue(
                            playlistTracks,
                            idx,
                            `playlist:${current.id}`,
                            current.name,
                          );
                        }}
                        onKeyDown={(e) => {
                          const dir =
                            e.key === "ArrowLeft"
                              ? -1
                              : e.key === "ArrowRight"
                                ? 1
                                : 0;
                          if (!e.ctrlKey || !e.shiftKey || dir === 0) return;
                          e.preventDefault();
                          const target = idx + dir;
                          if (target < 0 || target >= playlistItems.length)
                            return;
                          reorderPlaylistTracks(idx, target);
                        }}
                        className="relative shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        title={
                          isCurrent && player.playing
                            ? t("Pause")
                            : t("Lecture")
                        }
                        aria-label={
                          isCurrent && player.playing
                            ? t("Pause")
                            : t("Lecture")
                        }
                        aria-pressed={isCurrent && player.playing}
                      >
                        {it.cover ? (
                          <img
                            src={it.cover}
                            alt=""
                            className="size-10 rounded-lg object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                            <Music2 className="size-4 text-muted-foreground" />
                          </span>
                        )}
                        <span className="absolute inset-0 hidden items-center justify-center rounded-lg bg-black/55 text-white group-hover:flex group-focus-within:flex">
                          {isCurrent && player.playing ? (
                            <Pause className="size-4" />
                          ) : (
                            <Play className="size-4" />
                          )}
                        </span>
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm",
                            isCurrent
                              ? "font-semibold text-primary"
                              : "font-medium",
                          )}
                        >
                          {it.title || hostOf(it.url)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {hostOf(it.url)}
                        </p>
                      </div>
                      <button
                        type="button"
                        title={t("Retirer de la playlist")}
                        onClick={async () => {
                          try {
                            await removePlaylistItem(it.id);
                            refreshLists();
                          } catch (e) {
                            toast.error(describeError(e));
                          }
                        }}
                        className="cursor-pointer rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity outline-none group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              {/* bibliothèque vidéo en cartes vignettes */}
              <div className="flex items-center gap-3">
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
                  {t("Vidéos de ta bibliothèque")}
                </h2>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: association implicite valide (case enveloppee) */}
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={musicsOnly}
                    onCheckedChange={(v) => setMusicsOnly(v === true)}
                  />
                  {t("Musiques seules")}
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={tracks.length === 0}
                  onClick={() =>
                    playQueue(cardTracks, 0, "library", t("Vidéos"))
                  }
                >
                  <Play />
                  {t("Tout lire")}
                </Button>
              </div>
              {tracks.length === 0 && (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  {allVideos.length
                    ? t(
                        "Aucune piste marquée ♫ — clique la note sur une vidéo pour la déclarer musique.",
                      )
                    : t(
                        "Aucune vidéo dans la bibliothèque — ajoute un lien YouTube ou TikTok.",
                      )}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {tracks.map((r, idx) => {
                  const isSong = r.meta?.isSong === "1";
                  const isCurrent = playingUrl === r.url;
                  return (
                    <div
                      key={r.id}
                      className={cn(
                        "group overflow-hidden rounded-xl border bg-card transition-all hover:shadow-lg",
                        isCurrent && "border-primary/60 ring-1 ring-primary/40",
                      )}
                    >
                      {/* vignette 16:9 */}
                      <button
                        type="button"
                        onClick={() =>
                          isCurrent
                            ? setPlaying(!player.playing)
                            : playQueue(cardTracks, idx, "library", t("Vidéos"))
                        }
                        className="relative block aspect-video w-full overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                        title={
                          isCurrent && player.playing
                            ? t("Pause")
                            : t("Lecture")
                        }
                        aria-label={
                          isCurrent && player.playing
                            ? t("Pause")
                            : t("Lecture")
                        }
                        aria-pressed={isCurrent && player.playing}
                      >
                        {r.favicon ? (
                          <img
                            src={r.favicon}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <span className="flex size-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-2xl font-black text-muted-foreground/60 uppercase">
                            {r.title.slice(0, 2)}
                          </span>
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/35 group-hover:opacity-100 group-focus-within:bg-black/35 group-focus-within:opacity-100">
                          <span className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl">
                            {isCurrent && player.playing ? (
                              <Pause className="size-5" />
                            ) : (
                              <Play className="size-5" />
                            )}
                          </span>
                        </span>
                        {isCurrent && player.playing && (
                          <span className="absolute top-2 right-2">
                            <EqBadge />
                          </span>
                        )}
                      </button>
                      {/* barre d'actions */}
                      <div className="flex items-center gap-1 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {r.title}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {hostOf(r.url)}
                          </p>
                        </div>
                        <button
                          type="button"
                          title={
                            isSong
                              ? t("Retirer du filtre musiques")
                              : t("Déclarer comme musique")
                          }
                          onClick={() => void toggleSong(r)}
                          className={cn(
                            "cursor-pointer rounded-md p-1.5 outline-none transition-colors",
                            isSong
                              ? "text-primary"
                              : "text-muted-foreground/50 hover:text-foreground",
                          )}
                        >
                          <Music2
                            className={cn("size-4", isSong && "fill-current")}
                          />
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={t("Ajouter à…")}
                            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <Plus className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44">
                            <DropdownMenuGroup>
                              <DropdownMenuLabel>
                                {t("Ajouter à la playlist")}
                              </DropdownMenuLabel>
                              {lists.map((p) => (
                                <DropdownMenuItem
                                  key={p.id}
                                  onClick={() =>
                                    void addTo(p.id, {
                                      url: r.url,
                                      title: r.title,
                                      favicon: r.favicon,
                                    })
                                  }
                                >
                                  <ListMusic />
                                  {p.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                setAddNew({
                                  url: r.url,
                                  title: r.title,
                                  cover: r.favicon,
                                })
                              }
                            >
                              <Plus />
                              {t("Nouvelle playlist…")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
      <PromptDialog
        open={addNew !== null}
        title={t("Nouvelle playlist…")}
        placeholder={t("Nom de la playlist")}
        onDone={async (value) => {
          const ask = addNew;
          setAddNew(null);
          if (!ask || !value) return;
          const pl = await create(value);
          if (pl && ask !== "bare")
            void addTo(pl.id, {
              url: ask.url,
              title: ask.title,
              favicon: ask.cover,
            });
        }}
      />
    </ScrollArea>
  );
}
