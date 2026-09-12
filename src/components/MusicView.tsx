import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ListMusic,
  Loader2,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, type ConfirmState } from "@/components/ConfirmDialog";
import { PromptDialog } from "@/components/PromptDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
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
  updateResource,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { hostOf } from "@/lib/resources";
import type { MusicPlaylist, Resource } from "@/lib/types";
import { cn, describeError } from "@/lib/utils";

/**播放 d'une piste : le lecteur global (barre basse) écoute cet événement. */
function playTrack(url: string, title: string, cover: string) {
  window.dispatchEvent(
    new CustomEvent("vaultly:play-as-music", {
      detail: { url, title, favicon: cover },
    }),
  );
}

/**
 * Section Musique : toutes les vidéos de la bibliothèque comme pistes,
 * drapeau ♫ « musique », playlists locales, et import de playlists YouTube
 * (métadonnées via le moteur yt-dlp, nombre de morceaux plafonné et éditable).
 */
export function MusicView() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [musicsOnly, setMusicsOnly] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [importing, setImporting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [imp, setImp] = useState({ url: "", name: "", limit: "50" });
  // piste en attente d'ajout dans une playlist à créer (« Nouvelle playlist… »)
  const [addNew, setAddNew] = useState<{
    url: string;
    title: string;
    cover: string;
  } | null>(null);

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
  const tracks = (videos ?? []).filter(
    (r) => !musicsOnly || r.meta?.isSong === "1",
  );
  const current = lists.find((p) => p.id === selected) ?? null;

  async function refreshLists() {
    void qc.invalidateQueries({ queryKey: ["playlists"] });
    void qc.invalidateQueries({ queryKey: ["playlistItems"] });
  }

  async function create(name: string): Promise<MusicPlaylist | null> {
    const n = name.trim();
    if (!n) return null;
    try {
      const pl = await createPlaylist(n);
      setNewName("");
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
      const added = await addPlaylistItems(pl.id, found);
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

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex min-h-full w-full max-w-5xl gap-4 p-6">
        {/* colonne gauche : playlists + import */}
        <aside className="flex w-56 shrink-0 flex-col gap-1">
          <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("Playlists")}
          </p>
          <form
            className="flex gap-1 pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create(newName);
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("Nouvelle playlist…")}
              className="h-8 text-sm"
            />
            <Button type="submit" size="icon-sm" variant="outline">
              <Plus />
            </Button>
          </form>
          {lists.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {t(
                "Aucune playlist — crée-en une ou importe une playlist YouTube.",
              )}
            </p>
          )}
          {lists.map((p) => (
            <div
              key={p.id}
              className={cn(
                "group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm",
                selected === p.id
                  ? "bg-accent font-medium text-foreground"
                  : "cursor-pointer text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSelected(p.id);
              }}
            >
              <ListMusic className="size-4 shrink-0" />
              {renaming?.id === p.id ? (
                <form
                  className="flex min-w-0 flex-1 gap-1"
                  onClick={(e) => e.stopPropagation()}
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
                >
                  <Input
                    autoFocus
                    value={renaming.name}
                    onChange={(e) =>
                      setRenaming({ id: p.id, name: e.target.value })
                    }
                    onBlur={() => setRenaming(null)}
                    className="h-6 flex-1 px-1.5 text-sm"
                  />
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {p.count}
                  </span>
                  <button
                    type="button"
                    title={t("Renommer")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ id: p.id, name: p.name });
                    }}
                    className="hidden cursor-pointer rounded p-0.5 text-muted-foreground group-hover:block hover:text-foreground"
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
                    className="hidden cursor-pointer rounded p-0.5 text-muted-foreground group-hover:block hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </>
              )}
            </div>
          ))}

          {/* import de playlist web */}
          <div className="mt-3 rounded-xl border bg-card/60 p-2.5">
            <p className="pb-1.5 text-xs font-semibold">
              {t("Importer une playlist YouTube")}
            </p>
            {engine === false && (
              <>
                <p className="pb-1.5 text-[11px] text-muted-foreground">
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

        {/* colonne droite : bibliothèque vidéo OU pistes de la playlist */}
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          {current ? (
            <>
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">
                  {current.name}
                </h2>
                {(items?.length ?? 0) > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const first = items?.[0];
                      if (first) playTrack(first.url, first.title, first.cover);
                    }}
                  >
                    <Play />
                    {t("Tout lire")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(null)}
                  title={t("Retour aux vidéos")}
                >
                  <X />
                </Button>
              </div>
              {(items?.length ?? 0) === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {t(
                    "Playlist vide — ajoute des pistes depuis la liste des vidéos (bouton +).",
                  )}
                </p>
              )}
              {(items ?? []).map((it, idx) => (
                <div
                  key={it.id}
                  className="group flex items-center gap-2.5 rounded-xl border bg-card px-2.5 py-1.5"
                >
                  <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  {it.cover ? (
                    <img
                      src={it.cover}
                      alt=""
                      className="size-9 shrink-0 rounded-lg object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Music2 className="size-3.5 text-muted-foreground" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {it.title || hostOf(it.url)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {hostOf(it.url)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t("Lecture")}
                    onClick={() => playTrack(it.url, it.title, it.cover)}
                  >
                    <Play />
                  </Button>
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
              ))}
            </>
          ) : (
            <>
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
              </div>
              {tracks.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  {videos?.length
                    ? t(
                        "Aucune piste marquée ♫ — clique la note sur une vidéo pour la déclarer musique.",
                      )
                    : t(
                        "Aucune vidéo dans la bibliothèque — ajoute un lien YouTube ou TikTok.",
                      )}
                </p>
              )}
              {tracks.map((r) => {
                const isSong = r.meta?.isSong === "1";
                return (
                  <div
                    key={r.id}
                    className="group flex items-center gap-2.5 rounded-xl border bg-card px-2.5 py-1.5"
                  >
                    {r.favicon ? (
                      <img
                        src={r.favicon}
                        alt=""
                        className="size-9 shrink-0 rounded-lg object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Music2 className="size-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
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
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Lecture")}
                      onClick={() => playTrack(r.url, r.title, r.favicon)}
                    >
                      <Play />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t("Ajouter à…")}
                        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <Plus className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuLabel>
                          {t("Ajouter à la playlist")}
                        </DropdownMenuLabel>
                        {lists.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onClick={() => void addTo(p.id, r)}
                          >
                            <ListMusic />
                            {p.name}
                          </DropdownMenuItem>
                        ))}
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
                );
              })}
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
          const track = addNew;
          setAddNew(null);
          if (!track || !value) return;
          const pl = await create(value);
          if (pl)
            void addTo(pl.id, {
              url: track.url,
              title: track.title,
              favicon: track.cover,
            });
        }}
      />
    </ScrollArea>
  );
}
