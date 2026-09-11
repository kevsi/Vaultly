// Vaultly essaie 8765 puis les ports suivants (8780 max) au démarrage.
// Le port trouvé est mémorisé pour ne plus scanner ensuite.
const PORTS = Array.from({ length: 16 }, (_, i) => 8765 + i);

const $ = (id) => document.getElementById(id);

// page courante
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  $("url").value = tab?.url || "";
  $("title").value = tab?.title || "";
  try {
    $("domain").textContent = tab?.url ? new URL(tab.url).hostname : "";
  } catch {
    $("domain").textContent = "";
  }
});

// token + tags mémorisés
chrome.storage.local.get(["token", "tags"], (s) => {
  $("token").value = s.token || "";
  // pastille verte : un token est déjà mémorisé
  if (s.token) $("dot").classList.add("on");
  if (s.tags) $("tags").value = s.tags;
});

function show(msg, isErr, closeAfter) {
  const el = $("status");
  el.textContent = msg;
  el.className = isErr ? "err" : "ok";
  if (closeAfter) setTimeout(() => window.close(), 1200);
}

$("save").addEventListener("click", () => {
  // tolérance : si le collé contient le préfixe « Bearer », on l'enlève
  // (le placeholder l'a longtemps incité à le garder)
  const token = $("token")
    .value.trim()
    .replace(/^Bearer\s+/i, "");
  const url = $("url").value.trim();
  const title = $("title").value.trim();
  const tags = $("tags")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  chrome.storage.local.set({ token, tags });
  if (token) $("dot").classList.add("on");

  if (!token) return show("Colle ton token (Réglages de Vaultly)", true);
  if (!url.startsWith("http")) return show("Page sans lien web", true);

  $("save").disabled = true;
  show("Ajout en cours…");
  // essaie chaque port : celui qui répond à /api/add est le bon.
  // le port mémorisé est essayé en premier (scan évité en temps normal).
  // NB : token/url/title/tags sont PASSÉS EN PARAMÈTRES — les références
  // de portée externe ne résolvent pas depuis cette fonction.
  chrome.storage.local.get(["port"], (s) => {
    const order = s.port
      ? [s.port, ...PORTS.filter((p) => p !== s.port)]
      : PORTS;
    tryPorts(order, token, url, title, tags).finally(() => {
      $("save").disabled = false;
    });
  });
});

// --- Moisson d'onglets : range tous les onglets web de la fenêtre courante
// dans un dossier daté (« Onglets · 2026-09-09 »), via POST /api/add-bulk. ---
$("harvest").addEventListener("click", () => {
  chrome.storage.local.get(["token", "port"], (s) => {
    const token = (s.token || "").trim().replace(/^Bearer\s+/i, "");
    if (token) $("dot").classList.add("on");
    if (!token) return show("Colle ton token (Réglages de Vaultly)", true);
    void doHarvest(token, s.port);
  });
});

async function doHarvest(token, memoPort) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const seen = new Set();
  const items = [];
  for (const t of tabs) {
    const url = (t.url || "").trim();
    // ne garder que les vrais liens web (ignore chrome://, edge://, about:,
    // les pages vides de nouvel onglet…)
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, title: (t.title || "").trim() });
  }
  if (items.length === 0) return show("Aucun onglet web à enregistrer", true);

  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const folder = `Onglets · ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

  $("save").disabled = true;
  $("harvest").disabled = true;
  show(`Enregistrement de ${items.length} onglet(s)…`);
  const order = memoPort
    ? [memoPort, ...PORTS.filter((p) => p !== memoPort)]
    : PORTS;
  let data = null;
  let goodPort = null;
  let authFailed = false;
  for (const port of order) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/add-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ folder, items }),
      });
      try {
        data = await resp.json();
      } catch {
        data = { ok: false, error: await resp.text().catch(() => "") };
      }
      goodPort = port;
      if (resp.status === 401 || resp.status === 403) authFailed = true;
      break;
    } catch (e) {
      console.warn("port", port, "sans réponse :", e?.message);
    }
  }
  $("save").disabled = false;
  $("harvest").disabled = false;
  if (goodPort) chrome.storage.local.set({ port: goodPort });
  if (authFailed) show("Token refusé — recolle-le (Réglages de Vaultly)", true);
  else if (!data) show("Vaultly est-il ouvert sur cette machine ?", true);
  else if (data.ok)
    show(
      `${data.added} ajouté(s) · ${data.duplicates} doublon(s) → « ${data.folder} »`,
    );
  else show(data.error || "Erreur inattendue", true);
}

async function tryPorts(order, token, url, title, tags) {
  try {
    let data = null;
    let goodPort = null;
    let authFailed = false;
    for (const port of order) {
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/api/add`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url, title, tags }),
        });
        // le serveur répond en TEXTE BRUT sur 401/403 : un resp.json()
        // non protégé lèverait, ferait sauter le port et afficherait un
        // faux « app fermée » alors que c'est le token qui est refusé.
        try {
          data = await resp.json();
        } catch {
          data = { ok: false, error: await resp.text().catch(() => "") };
        }
        goodPort = port; // l'app répond sur ce port : inutile de scanner
        if (resp.status === 401 || resp.status === 403) {
          authFailed = true;
        }
        break;
      } catch (e) {
        console.warn("port", port, "sans réponse :", e?.message);
      }
    }
    if (goodPort) chrome.storage.local.set({ port: goodPort });
    if (authFailed)
      show(
        "Token refusé — recolle le token de l'extension (Réglages de Vaultly)",
        true,
      );
    else if (!data) show("Vaultly est-il ouvert sur cette machine ?", true);
    else if (data.ok && data.duplicate)
      show("Déjà dans ta bibliothèque", false, true);
    else if (data.ok) show("Ajouté à ta bibliothèque ✓", false, true);
    else show(data.error || "Erreur inattendue", true);
  } catch (e) {
    console.error("tryPorts :", e);
    show("Erreur réseau inattendue", true);
  }
}
