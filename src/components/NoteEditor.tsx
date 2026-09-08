import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { addResource, allTags, updateResource } from "@/lib/api";
import { isHtmlEmpty, RichTextEditor } from "@/components/RichTextEditor";
import { NOTE_COLORS } from "@/lib/resources";
import type { Resource } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** note existante à éditer, ou null pour une nouvelle */
  note: Resource | null;
  /** dossier courant : une NOUVELLE note y est rangée directement */
  initialFolderId?: number | null;
  onSaved: () => void;
}

export function NoteEditor({ open, onOpenChange, note, initialFolderId, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [color, setColor] = useState("amber");
  const [tagsInput, setTagsInput] = useState("");
  const [allTagsList, setAllTagsList] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(note?.title ?? "");
      setBody(note?.notes ?? "");
      setColor(note?.meta?.color ?? "amber");
      setTagsInput((note?.tags ?? []).join(", "));
      // suggestions pour le sélecteur de tags élargi (sans bloquer l'ouverture)
      void allTags()
        .then(setAllTagsList)
        .catch(() => setAllTagsList([]));
    }
  }, [open, note]);

  const parsedTags = useMemo(
    () => tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
    [tagsInput],
  );

  const suggestions = useMemo(() => {
    const current = new Set(parsedTags.map((t) => t.toLowerCase()));
    return allTagsList.filter((t) => !current.has(t.toLowerCase())).slice(0, 12);
  }, [allTagsList, parsedTags]);

  function toggleTag(tag: string) {
    setTagsInput((prev) => {
      const list = prev.split(",").map((t) => t.trim()).filter(Boolean);
      return [...list, tag].join(", ");
    });
  }

  async function save() {
    if (!title.trim() && isHtmlEmpty(body)) {
      toast.error("Donne un titre ou un contenu à la note");
      return;
    }
    setSaving(true);
    const payload = {
      url: note?.url ?? "",
      title: title.trim() || "Note",
      description: "",
      resourceType: "note",
      category: note?.category ?? "",
      tags: parsedTags,
      notes: body,
      favicon: "",
      favorite: note?.favorite ?? false,
      meta: { ...(note?.meta ?? {}), color },
      status: note?.status ?? "",
      // édition : garde son dossier ; création : dossier courant ouvert
      folderId: note?.folderId ?? initialFolderId ?? null,
    };
    try {
      if (note) {
        await updateResource(note.id, payload);
        toast.success("Note mise à jour");
      } else {
        await addResource(payload);
        toast.success("Note créée");
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{note ? "Modifier la note" : "Nouvelle note"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="note-title">Titre</Label>
            <Input
              id="note-title"
              autoFocus
              placeholder="Titre de la note"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-base font-semibold"
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Contenu</Label>
            {/* le corps riche est remonté à chaque ouverture via key */}
            <RichTextEditor
              key={note?.id ?? "new"}
              value={body}
              onChange={setBody}
            />
          </div>

          {/* sélecteur de tags élargi : pleine largeur + suggestions cliquables */}
          <div className="grid gap-1.5">
            <Label htmlFor="note-tags">
              Tags{" "}
              {parsedTags.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  ({parsedTags.length})
                </span>
              )}
            </Label>
            <Input
              id="note-tags"
              placeholder="ex : design, gratuit, ia — séparés par des virgules"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full"
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    title={`Ajouter #${t}`}
                    className="cursor-pointer rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Astuce : sépare par des virgules. Clique un tag suggéré pour l'ajouter.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Couleur :</span>
            {NOTE_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                title={c.label}
                aria-pressed={color === c.value}
                className={cn(
                  "size-7 cursor-pointer rounded-full border transition-transform",
                  c.dot,
                  color === c.value
                    ? "scale-110 ring-2 ring-offset-2 ring-offset-background ring-foreground/40"
                    : "hover:scale-105",
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {note ? "Enregistrer" : "Créer la note"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
