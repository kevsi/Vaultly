import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  getPlayerState,
  playQueue,
  shouldReresolveStream,
  stop,
  syncQueue,
  toggleShuffle,
} from "./playerStore";

function resetPlayer() {
  stop();
  if (getPlayerState().shuffle) toggleShuffle();
}

const queue = [
  { url: "https://a.example", title: "A", cover: "" },
  { url: "https://b.example", title: "B", cover: "" },
  { url: "https://c.example", title: "C", cover: "" },
];

describe("playerStore", () => {
  beforeEach(resetPlayer);

  it("playQueue démarre la piste demandée", () => {
    playQueue(queue, 1, "library", "Vidéos");
    const state = getPlayerState();
    expect(state.track?.url).toBe("https://b.example");
    expect(state.index).toBe(1);
    expect(state.playing).toBe(true);
  });

  it("playQueue([]) n'écrase pas l'index avec une piste fantôme", () => {
    playQueue([], 0, "playlist:1", "Playlist");
    const state = getPlayerState();
    expect(state.track).toBeNull();
    expect(state.index).toBe(-1);
    expect(state.playing).toBe(false);
    expect(state.queue).toEqual([]);
  });

  it("advance suit l'ordre puis s'arrête proprement", () => {
    playQueue(queue, 0, "library", "Vidéos");
    expect(advance()).toBe(true);
    expect(getPlayerState().track?.url).toBe("https://b.example");
    advance();
    expect(advance()).toBe(false);
    expect(getPlayerState().playing).toBe(false);
  });

  it("advance avec shuffle ne rejoue pas la piste courante", () => {
    playQueue(queue, 0, "library", "Vidéos");
    toggleShuffle();
    expect(advance()).toBe(true);
    expect(getPlayerState().track?.url).not.toBe("https://a.example");
  });

  it("advance sur une file shuffle d'une piste stoppe la lecture", () => {
    playQueue([queue[0]], 0, "library", "Vidéos");
    toggleShuffle();
    expect(advance()).toBe(false);
    expect(getPlayerState().playing).toBe(false);
  });

  it("playQueue garde l'index demandé sur une URL en double", () => {
    const dup = [queue[0], queue[1], queue[0]];
    playQueue(dup, 2, "library", "Vidéos");
    const state = getPlayerState();
    expect(state.index).toBe(2);
    expect(state.queue[state.index]).toBe(state.track);
  });

  it("advance shuffle garde index et piste cohérents sur une URL en double", () => {
    const dup = [queue[0], queue[1], queue[0]];
    playQueue(dup, 0, "library", "Vidéos");
    toggleShuffle();
    // force le 2ᵉ candidat de `rest` ([1, 2]) → index 2 (l'URL double de A)
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(advance()).toBe(true);
    const state = getPlayerState();
    expect(state.index).toBe(2);
    expect(state.queue[state.index]).toBe(state.track);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("syncQueue ignore une source différente", () => {
    playQueue(queue, 1, "library", "Vidéos");
    syncQueue("playlist:1", [queue[2]], "Playlist");
    const state = getPlayerState();
    expect(state.queue).toBe(queue);
    expect(state.track?.url).toBe("https://b.example");
  });

  it("syncQueue garde la piste courante quand elle survit", () => {
    playQueue(queue, 1, "playlist:1", "Playlist");
    syncQueue("playlist:1", [queue[2], queue[1]], "Playlist");
    const state = getPlayerState();
    expect(state.track?.url).toBe("https://b.example");
    expect(state.index).toBe(1);
  });

  it("syncQueue bascule sur la première piste retirée", () => {
    playQueue(queue, 1, "playlist:1", "Playlist");
    syncQueue("playlist:1", [queue[0], queue[2]], "Playlist");
    const state = getPlayerState();
    expect(state.track?.url).toBe("https://a.example");
    expect(state.index).toBe(0);
  });

  it("syncQueue garde la position courante sur une URL en double", () => {
    const dup = [queue[0], queue[1], queue[0]];
    playQueue(dup, 2, "playlist:1", "Playlist");
    syncQueue("playlist:1", [queue[0], queue[1], queue[0]], "Playlist");
    const state = getPlayerState();
    expect(state.index).toBe(2);
    expect(state.queue[state.index]).toBe(state.track);
  });
});

describe("shouldReresolveStream", () => {
  it("première erreur sur une URL éphémère → re-résoudre la même piste", () => {
    expect(shouldReresolveStream("https://redirector/expire=1?s=Y", null)).toBe(
      true,
    );
  });

  it("même URL déjà retentée → on n'insiste pas (sinon boucle)", () => {
    expect(shouldReresolveStream("url-a", "url-a")).toBe(false);
  });

  it("URL vide → rien à résoudre", () => {
    expect(shouldReresolveStream("", null)).toBe(false);
  });

  it("erreur sur une URL fraîche (différente de la dernière retentée) → autorisé", () => {
    expect(shouldReresolveStream("url-b", "url-a")).toBe(true);
  });
});
