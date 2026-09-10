import {
  Folder as FolderIcon,
  FolderMinus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Folder } from "@/lib/types";

interface Props {
  folder: Folder;
  onOpen: (f: Folder) => void;
  onRename: (f: Folder) => void;
  onDissolve: (f: Folder) => void;
  onDelete: (f: Folder) => void;
  /** une tuile ressource est en train d'être glissée dessus */
  dropHint?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

/** Tuile « dossier » : pile de 4 icônes des ressources contenues. */
export function FolderTile({
  folder,
  onOpen,
  onRename,
  onDissolve,
  onDelete,
  dropHint,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  const slots = [0, 1, 2, 3];
  return (
    <div
      className="group relative"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        role="button"
        tabIndex={0}
        title={`${folder.name} — ${folder.count} ressource${folder.count > 1 ? "s" : ""}`}
        onClick={() => onOpen(folder)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault(); // Espace : pas de scroll de page
            onOpen(folder);
          }
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`flex aspect-square cursor-pointer select-none flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 transition-all duration-200 ease-out outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] ${
          dropHint ? "ring-2 ring-primary/60" : ""
        }`}
      >
        {/* pile 2x2 des icônes */}
        <div className="grid size-16 shrink-0 grid-cols-2 place-content-center gap-0.5 rounded-lg bg-muted/50 p-1">
          {slots.map((i) => {
            const src = folder.previewIcons[i];
            return (
              <div
                key={i}
                className="flex size-7 items-center justify-center overflow-hidden rounded"
              >
                {src ? (
                  <img src={src} alt="" className="size-full object-contain" />
                ) : (
                  <FolderIcon className="size-3.5 text-muted-foreground/60" />
                )}
              </div>
            );
          })}
        </div>
        <span className="line-clamp-2 min-h-8 text-center text-xs font-medium leading-tight">
          {folder.name}
        </span>
        <span
          className="flex min-w-6 items-center justify-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
          title={`${folder.count} ressource${folder.count > 1 ? "s" : ""}`}
        >
          {folder.count}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Options du dossier"
          className="absolute -right-1.5 -top-1.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[popup-open]:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          <DropdownMenuItem onClick={() => onOpen(folder)}>
            Ouvrir le dossier
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(folder)}>
            <Pencil />
            Renommer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onDissolve(folder)}
            title="Retire le dossier mais garde ses ressources (elles reviennent dans la grille)"
          >
            <FolderMinus />
            Dissoudre
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(folder)}
          >
            <Trash2 />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
