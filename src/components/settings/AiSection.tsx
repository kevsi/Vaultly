import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Plug, RefreshCw } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ConfirmState } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getMcpStatus, mcpRegenerateToken } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { describeError } from "@/lib/utils";

function CopyBlock({ label, code }: { label: string; code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("Copié") : t("Copier")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

interface AiSectionProps {
  setConfirm: Dispatch<SetStateAction<ConfirmState | null>>;
}

export function AiSection({ setConfirm }: AiSectionProps) {
  const { t } = useI18n();
  const { data: status, isLoading } = useQuery({
    queryKey: ["mcpStatus"],
    queryFn: getMcpStatus,
  });
  const qc = useQueryClient();
  const [regenBusy, setRegenBusy] = useState(false);

  async function runRegenerateToken() {
    setConfirm({
      title: t("Régénérer le token MCP ?"),
      message: t(
        "Les clients IA déjà configurés devront être mis à jour. Le token de l'extension n'est pas affecté.",
      ),
      confirmLabel: t("Régénérer"),
      action: async () => {
        setRegenBusy(true);
        try {
          await mcpRegenerateToken();
          toast.success(t("settings.regenerated-mcp"));
          void qc.invalidateQueries({ queryKey: ["mcpStatus"] });
        } catch (e) {
          toast.error(describeError(e));
        } finally {
          setRegenBusy(false);
        }
      },
    });
  }

  const url = status?.url ?? "http://127.0.0.1:8765/mcp";
  const token = status?.token ?? "";

  const zcodeSnippet = JSON.stringify(
    {
      mcp: {
        servers: {
          vaultly: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
    },
    null,
    2,
  );

  const claudeSnippet = `claude mcp add --transport http vaultly ${url} \\
  --header "Authorization: Bearer ${token}"`;

  const cursorSnippet = JSON.stringify(
    {
      mcpServers: {
        vaultly: {
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );

  return (
    <>
      {/* statut serveur */}
      <div className="rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" />
          <span className="font-medium">{t("settings.mcp-server")}</span>
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : status?.running ? (
            <Badge>{t("settings.online-port", { port: status.port })}</Badge>
          ) : (
            <Badge variant="destructive">{t("settings.offline")}</Badge>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Tant que Vaultly est ouvert, toute IA compatible MCP peut rechercher, consulter et enrichir tes ressources via ce serveur local. Les requêtes distantes exigent le token ci-dessous.",
          )}
        </p>
      </div>

      <Separator />

      {/* snippets */}
      <div className="space-y-4">
        <div>
          <h3 className="font-medium">{t("settings.connect-ai")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Ajoute ce serveur à ton client MCP préféré. Le token est propre à cette machine — ne le partage pas.",
            )}
          </p>
        </div>

        {/* jamais de snippet avec un « Bearer » vide : tant que le statut
              n'a pas répondu, le copier produirait une config cassée */}
        {!token ? (
          <p className="text-sm text-muted-foreground">
            {status
              ? t("settings.server-offline")
              : t("settings.loading-token")}
          </p>
        ) : (
          <>
            <CopyBlock label={t("settings.zcode-config")} code={zcodeSnippet} />

            <CopyBlock
              label={t("settings.claude-command")}
              code={claudeSnippet}
            />

            <CopyBlock
              label={t("settings.cursor-config")}
              code={cursorSnippet}
            />
          </>
        )}
      </div>

      <Separator />

      {/* token MCP brut (clients IA) */}
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">
          {t("Token MCP (clients IA)")}
        </span>
        <code className="break-all rounded-lg bg-muted p-2 text-xs">
          {token || "…"}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              void navigator.clipboard.writeText(token);
            }}
          >
            <Copy />
            {t("Copier le token")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void runRegenerateToken()}
            disabled={regenBusy}
          >
            {regenBusy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("Régénérer")}
          </Button>
        </div>
      </div>
    </>
  );
}
