import {
  Bold,
  Eraser,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PromptDialog } from "@/components/PromptDialog";
import { useI18n } from "@/lib/i18n";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

function statsOf(html: string): {
  words: number;
  chars: number;
  minutes: number;
} {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { words: 0, chars: 0, minutes: 0 };
  const words = text.split(" ").filter(Boolean).length;
  return {
    words,
    chars: text.length,
    minutes: Math.max(1, Math.ceil(words / 200)),
  };
}

/**
 * Éditeur riche minimal (contentEditable + barre d'outils), sans dépendance.
 * Valeur = HTML. Sert aux notes post-it.
 *
 * Affiche une barre d'infos utiles sous la zone : compteur
 * mots / caractères, temps de lecture estimé et rappel des raccourcis.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  showStats = true,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  showStats?: boolean;
}) {
  const { t } = useI18n();
  const ph = placeholder ?? t("Écris ta note…");
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [html, setHtml] = useState(value || "");

  // Synchronisation quand `value` change de l'extérieur. React exécute les
  // effets de l'enfant AVANT ceux du parent : au remontage du dialogue, ce
  // `value` est encore l'ancien state du parent (note précédente, ou vide).
  // Sans resynchronisation ici, l'éditeur afficherait un contenu périmé et
  // l'enregistrer écraserait la note. On ne touche au DOM que si l'éditeur
  // n'a pas le focus : pendant la frappe, value === innerHTML (round-trip
  // via onChange) et un reset casserait le curseur.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clean = sanitizeHtml(value || "");
    if (el.innerHTML !== clean && document.activeElement !== el) {
      el.innerHTML = clean;
      setHtml(clean);
    }
  }, [value]);

  const stats = useMemo(() => statsOf(html), [html]);

  function emit() {
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    onChange(next);
  }

  function exec(command: string, arg?: string) {
    document.execCommand(command, false, arg);
    ref.current?.focus();
    emit();
  }

  /** Le lien saisi est validé http(s) AVANT insertion : window.prompt
   *  acceptait n'importe quoi (javascript:…) inséré en direct dans le DOM. */
  function onLinkSubmit(url: string | null) {
    setLinkOpen(false);
    if (!url) return;
    const v =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `https://${url}`;
    exec("createLink", v);
  }

  const btn =
    "flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* barre d'outils — onMouseDown preventDefault : garder la sélection
          du texte pendant le clic sur un bouton (pattern contentEditable) */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1"
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          title={t("Annuler (Ctrl+Z)")}
          className={btn}
          onClick={() => exec("undo")}
        >
          <Undo2 className="size-4" />
        </button>
        <button
          type="button"
          title={t("Rétablir (Ctrl+Y)")}
          className={btn}
          onClick={() => exec("redo")}
        >
          <Redo2 className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          title={t("Gras (Ctrl+B)")}
          className={btn}
          onClick={() => exec("bold")}
        >
          <Bold className="size-4" />
        </button>
        <button
          type="button"
          title={t("Italique (Ctrl+I)")}
          className={btn}
          onClick={() => exec("italic")}
        >
          <Italic className="size-4" />
        </button>
        <button
          type="button"
          title={t("Souligné (Ctrl+U)")}
          className={btn}
          onClick={() => exec("underline")}
        >
          <Underline className="size-4" />
        </button>
        <button
          type="button"
          title={t("Barré")}
          className={btn}
          onClick={() => exec("strikeThrough")}
        >
          <Strikethrough className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          title={t("Titre")}
          className={btn}
          onClick={() => exec("formatBlock", "<h3>")}
        >
          <Heading2 className="size-4" />
        </button>
        <button
          type="button"
          title={t("Liste à puces")}
          className={btn}
          onClick={() => exec("insertUnorderedList")}
        >
          <List className="size-4" />
        </button>
        <button
          type="button"
          title={t("Liste numérotée")}
          className={btn}
          onClick={() => exec("insertOrderedList")}
        >
          <ListOrdered className="size-4" />
        </button>
        <button
          type="button"
          title={t("Citation")}
          className={btn}
          onClick={() => exec("formatBlock", "<blockquote>")}
        >
          <Quote className="size-4" />
        </button>
        <button
          type="button"
          title={t("Lien")}
          className={btn}
          onClick={() => setLinkOpen(true)}
        >
          <Link2 className="size-4" />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          title={t("Effacer la mise en forme")}
          className={btn}
          onClick={() => exec("removeFormat")}
        >
          <Eraser className="size-4" />
        </button>
      </div>
      {/* zone éditable */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("Contenu de la note")}
        data-placeholder={ph}
        onInput={emit}
        onPaste={(e) => {
          // Collage : le HTML du presse-papiers est nettoyé AVANT insertion,
          // sinon des balises/attributs hostiles entrent dans le DOM vivant
          // et dans la valeur stockée brute.
          e.preventDefault();
          const pasted = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          if (pasted) {
            document.execCommand("insertHTML", false, sanitizeHtml(pasted));
          } else if (text) {
            document.execCommand("insertText", false, text);
          }
          emit();
        }}
        onDrop={(e) => {
          // Glisser-déposer : même garde que le collage. Sans ce handler,
          // Chromium insère le fragment text/html BRUT (img onerror,
          // a href=javascript:…) dans le DOM vivant puis onInput le persiste.
          e.preventDefault();
          const dropped = e.dataTransfer.getData("text/html");
          const text = e.dataTransfer.getData("text/plain");
          if (dropped) {
            document.execCommand("insertHTML", false, sanitizeHtml(dropped));
          } else if (text) {
            document.execCommand("insertText", false, text);
          }
          emit();
        }}
        className={cn(
          "note-content min-h-40 max-h-[45vh] overflow-y-auto px-4 py-3 text-[15px] leading-relaxed outline-none",
          "[&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-muted-foreground",
        )}
      />
      {/* infos utiles : compteurs + aide */}
      {showStats && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t("{count} mot(s) · {chars} caractère(s)", {
              count: stats.words,
              chars: stats.chars,
            })}
          </span>
          {stats.words > 0 && (
            <span>{t("· lecture ~{count} min", { count: stats.minutes })}</span>
          )}
          <span className="ml-auto hidden sm:inline">
            {t(
              "Ctrl+B gras · Ctrl+I italique · Ctrl+U souligné · listes et citation via la barre",
            )}
          </span>
        </div>
      )}
      <PromptDialog
        open={linkOpen}
        title={t("Adresse du lien")}
        description={t("Colle l'URL de destination (https://…)")}
        placeholder="https://exemple.com"
        confirmLabel={t("Insérer le lien")}
        onDone={onLinkSubmit}
      />
    </div>
  );
}

// petit export utilitaire pour l'état « vide »
export function isHtmlEmpty(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return text.length === 0;
}
