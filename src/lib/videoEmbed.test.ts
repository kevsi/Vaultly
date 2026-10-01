import { describe, expect, it } from "vitest";
import { embedEnded, videoEmbedUrl } from "./videoEmbed";

describe("videoEmbedUrl", () => {
  it("extrait l'id YouTube de tous les formats connus", () => {
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoEmbedUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("conserve la playlist YouTube (list=)", () => {
    expect(
      videoEmbedUrl(
        "https://www.youtube.com/watch?v=abc123&list=PLxxxxxxxxxxxxxxxxx",
      ),
    ).toBe(
      "https://www.youtube-nocookie.com/embed/abc123?list=PLxxxxxxxxxxxxxxxxx",
    );
  });

  it("embarque TikTok (URL /video/<id> seulement)", () => {
    expect(videoEmbedUrl("https://www.tiktok.com/@user/video/1234567890")).toBe(
      "https://www.tiktok.com/embed/v2/1234567890",
    );
    expect(videoEmbedUrl("https://vm.tiktok.com/ZMabc12/")).toBeNull();
  });

  it("embarque Vimeo et Dailymotion", () => {
    expect(videoEmbedUrl("https://vimeo.com/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    expect(videoEmbedUrl("https://www.dailymotion.com/video/x8abcd")).toBe(
      "https://www.dailymotion.com/embed/video/x8abcd",
    );
  });

  it("embarque Twitch VOD/clips avec parent, pas les chaînes live", () => {
    expect(videoEmbedUrl("https://www.twitch.tv/videos/123456789")).toBe(
      "https://player.twitch.tv/?video=123456789&parent=tauri.localhost&parent=localhost",
    );
    expect(videoEmbedUrl("https://clips.twitch.tv/ClipNameHere123")).toBe(
      "https://clips.twitch.tv/embed?clip=ClipNameHere123&parent=tauri.localhost&parent=localhost",
    );
    expect(videoEmbedUrl("https://www.twitch.tv/somechannel")).toBeNull();
  });

  it("rejette ce qui n'est pas une vidéo embarquable", () => {
    expect(videoEmbedUrl("https://example.com/watch?v=abc123")).toBeNull();
    expect(videoEmbedUrl("pas une url")).toBeNull();
    expect(videoEmbedUrl("https://youtube.com/watch?v=")).toBeNull();
    expect(videoEmbedUrl("file:///C:/videos/clip.mp4")).toBeNull();
  });
});

describe("embedEnded", () => {
  const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
  const vimeo = "https://player.vimeo.com/video/76979871";
  const dm = "https://www.dailymotion.com/embed/video/x8abcd";

  it("détecte la fin YouTube (playerState 0)", () => {
    expect(
      embedEnded(yt, "https://www.youtube-nocookie.com", {
        event: "onStateChange",
        info: { playerState: 0 },
      }),
    ).toBe(true);
    expect(
      embedEnded(yt, "https://www.youtube-nocookie.com", {
        event: "onStateChange",
        info: { playerState: 1 },
      }),
    ).toBe(false);
  });

  it("détecte la fin Vimeo (event finish)", () => {
    expect(embedEnded(vimeo, "https://player.vimeo.com", { event: "finish" })).toBe(
      true,
    );
  });

  it("refuse une origine qui ne correspond pas au lecteur", () => {
    expect(
      embedEnded(yt, "https://evil.example", {
        event: "onStateChange",
        info: { playerState: 0 },
      }),
    ).toBe(false);
    expect(
      embedEnded(vimeo, "https://evil.example", { event: "finish" }),
    ).toBe(false);
  });

  it("refuse les messages non reconnus (Dailymotion/TikTok/Twitch : pas d'event de fin documenté, données non objet)", () => {
    expect(embedEnded(dm, "https://www.dailymotion.com", { event: "end" })).toBe(
      false,
    );
    expect(embedEnded(yt, "https://www.youtube-nocookie.com", "chaîne libre")).toBe(
      false,
    );
    expect(embedEnded(yt, "https://www.youtube-nocookie.com", null)).toBe(false);
  });
});
