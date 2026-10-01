/**
 * État global du lecteur Musique — module singleton (comme `appearance.ts`)
 * pour que la vue Musique, la barre lecteur et le menu ⋯ des tuiles parlent
 * au même lecteur sans props drilling. Le store ne joue rien lui-même : il
 * décrit la file ; le composant MusicPlayer exécute.
 */
import { useSyncExternalStore } from "react";

export interface PlayerTrack {
  url: string;
  title: string;
  cover: string;
}

interface PlayerState {
  track: PlayerTrack | null;
  /** file en cours (playlist ou sélection) ; vide = piste isolée */
  queue: PlayerTrack[];
  /** index de `track` dans la file (-1 si hors file) */
  index: number;
  playing: boolean;
  shuffle: boolean;
  /** identifiant stable de la source (« playlist:3 », « library »…) */
  sourceKey: string;
  /** libellé affiché par le lecteur (« Road trip », « Vidéos »…) */
  source: string;
}

let state: PlayerState = {
  track: null,
  queue: [],
  index: -1,
  playing: false,
  shuffle: false,
  sourceKey: "",
  source: "",
};

const listeners = new Set<() => void>();

function set(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Piste isolée (menu ⋯ « Écouter » des tuiles) : remplace toute la file. */
export function playTrack(t: PlayerTrack, sourceLabel = "", sourceKey = "") {
  set({
    track: t,
    queue: [t],
    index: 0,
    playing: true,
    source: sourceLabel,
    sourceKey,
  });
}

/** Lance une file depuis une piste donnée (« Tout lire » / clic de ligne). */
export function playQueue(
  tracks: PlayerTrack[],
  startIndex = 0,
  sourceKey = "",
  sourceLabel = "",
) {
  // index calculé à la création — jamais `tracks.indexOf(t)` : sur une URL
  // en double, indexOf rendrait toujours la première occurrence et le
  // compteur « n/N » comme previous/next dériveraient
  const index = startIndex >= 0 && startIndex < tracks.length ? startIndex : 0;
  const t = tracks[index] ?? null;
  set({
    track: t,
    queue: tracks,
    index: t === null ? -1 : index,
    playing: t !== null,
    source: sourceLabel,
    sourceKey,
  });
}

/** Fin de piste → suivante : ordre ou aléatoire sans répétition de la file. */
export function advance(): boolean {
  if (state.queue.length === 0) return false;
  if (state.shuffle) {
    // indices, pas objets : `indexOf` sur une URL en double sauterait
    // toujours à la première occurrence
    const rest = state.queue.map((_, i) => i).filter((i) => i !== state.index);
    if (rest.length === 0) {
      // file à 1 piste : rien à enchaîner → arrêt propre (sinon l'UI
      // « playing » ne peut que diverger : aucun re-mount ne rejouera)
      set({ playing: false });
      return false;
    }
    const next = rest[Math.floor(Math.random() * rest.length)];
    set({
      track: state.queue[next],
      index: next,
      playing: true,
    });
    return true;
  }
  const next = state.index + 1;
  if (next >= state.queue.length) {
    // fin de la file : on s'arrête proprement sur la dernière piste
    set({ playing: false });
    return false;
  }
  set({ track: state.queue[next], index: next, playing: true });
  return true;
}

export function previous() {
  if (state.queue.length === 0) return;
  const prev = Math.max(0, state.index - 1);
  set({ track: state.queue[prev], index: prev, playing: true });
}

/** La playlist source vient d'être éditée (piste retirée, ordre changé) :
 *  on resynchronise la file si — et seulement si — c'est bien elle qui
 *  alimente le lecteur ; la piste courante est conservée si elle survit. */
export function syncQueue(
  sourceKey: string,
  tracks: PlayerTrack[],
  sourceLabel: string,
) {
  if (state.sourceKey !== sourceKey) return;
  if (tracks.length === 0) {
    stop();
    return;
  }
  const currentUrl = state.track?.url;
  // sur une URL en double, rester à l'index courant si la même URL y est
  // toujours (indexOf sauterait à la première occurrence et décalerait la file)
  let i: number;
  if (currentUrl === undefined) {
    i = state.index;
  } else if (tracks[state.index]?.url === currentUrl) {
    i = state.index;
  } else {
    i = tracks.findIndex((t) => t.url === currentUrl);
  }
  if (i === -1) {
    // la piste jouée n'est plus dans la playlist : on bascule sur la première
    set({ queue: tracks, index: 0, track: tracks[0], source: sourceLabel });
    return;
  }
  set({ queue: tracks, index: i, track: tracks[i], source: sourceLabel });
}

export function setPlaying(v: boolean) {
  set({ playing: v });
}

export function toggleShuffle() {
  set({ shuffle: !state.shuffle });
}

export function stop() {
  set({
    track: null,
    queue: [],
    index: -1,
    playing: false,
    source: "",
    sourceKey: "",
  });
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Lecture non réactive (tests, utilitaires hors React). */
export function getPlayerState(): PlayerState {
  return state;
}
