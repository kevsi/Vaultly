import { useQuery } from "@tanstack/react-query";
import { Cloud, Download, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  webdavBackup,
  webdavClearConfig,
  webdavRestore,
  webdavSetAutobackup,
  webdavSetConfig,
  webdavStatus,
  webdavTestConnection,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { describeError, isInsecureRemoteWebdav } from "@/lib/utils";

function formatBackupDate(
  ts: number | null | undefined,
  t: (key: string) => string,
): string {
  if (ts == null) return t("Jamais");
  const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
  return new Date(ms).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Sauvegarde cloud simple via WebDAV : pas de compte développeur, pas
 * d'OAuth — url + identifiant + mot de passe. Koofr offre 2 Go gratuits ;
 * Nextcloud/Synology fonctionnent aussi. Le backend ne touche qu'aux
 * fichiers vaultly-backup-*.json du dossier ciblé.
 */
export function WebDavBackupSection() {
  const { t } = useI18n();
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPass, setWebdavPass] = useState("");
  const [webdavBusy, setWebdavBusy] = useState(false);
  const [webdavAuto, setWebdavAuto] = useState(false);
  const [webdavInterval, setWebdavInterval] = useState("24");
  const { data: webdav, refetch } = useQuery({
    queryKey: ["webdavStatus"],
    queryFn: webdavStatus,
  });
  useEffect(() => {
    if (webdav) {
      setWebdavAuto(webdav.autobackupEnabled);
      setWebdavInterval(String(webdav.autobackupIntervalHours));
    }
  }, [webdav]);

  async function saveWebdav() {
    setWebdavBusy(true);
    try {
      await webdavSetConfig(webdavUrl.trim(), webdavUser.trim(), webdavPass);
      setWebdavPass("");
      // test immédiat : l'utilisateur sait si ça marche, sans second clic
      const n = await webdavTestConnection();
      toast.success(
        n > 0
          ? t("Connecté ✓ — {count} sauvegarde(s) déjà présente(s)", {
              count: n,
            })
          : t("Connecté ✓ — le dossier est vide"),
      );
      void refetch();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function clearWebdav() {
    setWebdavBusy(true);
    try {
      await webdavClearConfig();
      setWebdavUrl("");
      setWebdavUser("");
      setWebdavPass("");
      toast.success(t("Configuration WebDAV effacée"));
      void refetch();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function runWebdavBackup() {
    setWebdavBusy(true);
    try {
      const name = await webdavBackup();
      toast.success(t("Sauvegardé sur le cloud : {name}", { name }));
      void refetch();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function runWebdavRestoreLatest() {
    setWebdavBusy(true);
    try {
      const r = await webdavRestore();
      toast.success(
        t("{count} ressource(s) restaurée(s), {count2} doublon(s) ignoré(s)", {
          count: r.resourcesAdded,
          count2: r.duplicates,
        }),
      );
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function saveWebdavAuto(enabled: boolean) {
    const hours = Math.max(1, Number(webdavInterval) || 24);
    setWebdavAuto(enabled);
    try {
      await webdavSetAutobackup(enabled, hours);
      void refetch();
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{t("Sauvegarde cloud (WebDAV)")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Envoie tes sauvegardes sur Koofr (2 Go gratuits), Nextcloud, Synology… Trois champs, pas de compte développeur à créer : l'URL d'un dossier WebDAV, un identifiant, un mot de passe. Les 5 sauvegardes les plus récentes sont conservées en ligne.",
            )}
          </p>
        </div>
        {webdav?.configured ? (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            {t("Configuré")}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {t("Non configuré")}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <Input
          placeholder={t(
            "URL WebDAV — ex : https://app.koofr.net/dav/Koofr/Vaultly",
          )}
          value={webdavUrl}
          onChange={(e) => setWebdavUrl(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {isInsecureRemoteWebdav(webdavUrl.trim() || webdav?.url || "") && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {t("URL en")} <code className="font-mono">http://</code>{" "}
              {t(
                "vers un serveur distant : ton identifiant et ton mot de passe circulent",
              )}{" "}
              <b>{t("non chiffrés")}</b>. {t("Privilégie une URL")}{" "}
              <code className="font-mono">https://</code>{" "}
              {t("(excepté pour un NAS en réseau local).")}
            </span>
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            placeholder={t("Identifiant")}
            value={webdavUser}
            onChange={(e) => setWebdavUser(e.target.value)}
            autoComplete="off"
          />
          <Input
            type="password"
            placeholder={
              webdav?.configured
                ? t("Mot de passe — vide pour conserver l'actuel")
                : t("Mot de passe (ou token d'application)")
            }
            value={webdavPass}
            onChange={(e) => setWebdavPass(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={webdavBusy || !webdavUrl.trim() || !webdavUser.trim()}
            onClick={() => void saveWebdav()}
          >
            {webdavBusy ? <Loader2 className="animate-spin" /> : null}
            {t("Enregistrer et tester")}
          </Button>
          {webdav?.configured && (
            <Button
              variant="ghost"
              size="sm"
              disabled={webdavBusy}
              onClick={() => void clearWebdav()}
            >
              {t("Effacer la configuration")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "Ton mot de passe est chiffré et reste sur cette machine. Sur Nextcloud, utilise un token de « Paramètres → Applis → DAV » plutôt que ton mot de passe si l'authentification à deux facteurs est active.",
          )}
        </p>
      </div>

      {webdav?.configured && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void runWebdavBackup()}
              disabled={webdavBusy}
            >
              {webdavBusy ? <Loader2 className="animate-spin" /> : <Cloud />}
              {t("Sauvegarder maintenant")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runWebdavRestoreLatest()}
              disabled={webdavBusy}
            >
              <Download />
              {t("Restaurer la dernière")}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch
              checked={webdavAuto}
              disabled={webdavBusy}
              onCheckedChange={(c: boolean) => void saveWebdavAuto(c)}
            />
            <span>{t("Sauvegarde automatique toutes les")}</span>
            <Input
              className="w-20"
              inputMode="numeric"
              value={webdavInterval}
              onChange={(e) => setWebdavInterval(e.target.value)}
              onBlur={() => void saveWebdavAuto(webdavAuto)}
            />
            <span className="text-muted-foreground">{t("heures")}</span>
          </div>
          {webdav?.lastBackupAt && (
            <p className="text-xs text-muted-foreground">
              {t("Dernière sauvegarde cloud :")}{" "}
              {formatBackupDate(webdav.lastBackupAt, t)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
