import { mkdirSync, writeFileSync } from "node:fs";

// Petit générateur de 3 animations Lottie vectorielles minimalistes
// (aucun asset externe, hors-ligne). Structures volontairement réduites aux
// primitives les mieux supportées par lottie-web : ellipse, rect, fill, stroke,
// transforme de calque (position/échelle/rotation/opacité) en keyframes.

const W = 200;
const H = 200;
const FR = 60;
const OP = 90;
const PRIMARY = [0.77, 0.42, 0.28, 1]; // terracotta
const SOFT = [0.77, 0.42, 0.28, 1];

// keyframe linéaire 3D (scale / position) ; dernière image sans easing
const kf3 = (t, s, first = true) =>
  first
    ? {
        t,
        s,
        i: { x: [0.42, 0.42, 0.42], y: [1, 1, 1] },
        o: { x: [0.58, 0.58, 0.58], y: [0, 0, 0] },
      }
    : { t, s };
const lin1 = (t, k, first = true) =>
  first
    ? { t, s: [k], i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } }
    : { t, s: [k] };

const grp = (items, name) => ({ ty: "gr", it: items, nm: name, np: items.length });
const tr = () => ({
  ty: "tr",
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
});
const el = (sx, sy) => ({ ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [sx, sy] }, d: 1 });
const rc = (x, y, sx, sy, r) => ({
  ty: "rc",
  p: { a: 0, k: [x, y] },
  s: { a: 0, k: [sx, sy] },
  r: { a: 0, k: r },
  d: 1,
});
const st = (w, c) => ({ ty: "st", c: { a: 0, k: c }, o: { a: 0, k: 100 }, w: { a: 0, k: w }, lc: 2, lj: 2 });
const fl = (c) => ({ ty: "fl", c: { a: 0, k: c }, o: { a: 0, k: 100 }, r: 1 });

const shapeLayer = (ind, name, ks, shapes) => ({
  ddd: 0,
  ind,
  ty: 4,
  nm: name,
  sr: 1,
  ks,
  ao: 0,
  shapes,
  ip: 0,
  op: OP,
  st: 0,
  bm: 0,
});
const staticScale = { a: 0, k: [100, 100, 100] };
const rot0 = { a: 0, k: 0 };

function anim(layers, name) {
  return {
    v: "5.7.4",
    fr: FR,
    ip: 0,
    op: OP,
    w: W,
    h: H,
    nm: name,
    ddd: 0,
    assets: [],
    layers,
  };
}

// 1) Anneau pulsé + halo — « bienvenue »
const welcome1 = anim(
  [
    shapeLayer(
      1,
      "ring",
      {
        o: { a: 0, k: 100 },
        r: rot0,
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [kf3(0, [100, 100, 100]), kf3(45, [120, 120, 100], false), kf3(90, [100, 100, 100], false)] },
      },
      [grp([el(130, 130), st(9, PRIMARY), tr()], "g")],
    ),
    shapeLayer(
      2,
      "halo",
      {
        o: { a: 1, k: [lin1(0, 45), lin1(45, 8), lin1(90, 45, false)] },
        r: rot0,
        p: { a: 0, k: [100, 100, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 1, k: [kf3(0, [70, 70, 100]), kf3(45, [150, 150, 100], false), kf3(90, [70, 70, 100], false)] },
      },
      [grp([el(120, 120), fl(SOFT), tr()], "g")],
    ),
  ],
  "welcome-pulse",
);

// 2) Trois points qui rebondissent en décalé — « ranger / organiser »
function dot(ind, x, phase) {
  const base = [x, 100, 0];
  const up = [x, 78, 0];
  return shapeLayer(
    ind,
    `dot${ind}`,
    {
      o: { a: 0, k: 100 },
      r: rot0,
      a: { a: 0, k: [0, 0, 0] },
      s: staticScale,
      p: {
        a: 1,
        k: [
          kf3(0, base),
          kf3(20, up, false),
          kf3(45, base, false),
          kf3(90, base, false),
        ],
      },
    },
    [grp([el(34, 34), fl(SOFT), tr()], "g")],
  );
}
const welcome2 = anim(
  [dot(1, 60, 0), dot(2, 100, 1), dot(3, 140, 2)].map((l, i) => {
    // décale chaque point dans le temps pour l'effet « vague »
    const shift = i * 8;
    l.ks.p.k = l.ks.p.k.map((k) => ({ ...k, t: Math.max(0, Math.min(OP, k.t + shift)) }));
    return l;
  }),
  "welcome-dots",
);

// 3) Loupe animée (legère rotation + translation) — « chercher / IA »
const welcome3 = anim(
  [
    shapeLayer(
      1,
      "magnifier",
      {
        o: { a: 0, k: 100 },
        r: { a: 1, k: [lin1(0, -12), lin1(30, 10, false), lin1(60, -6, false), lin1(90, -12, false)] },
        p: {
          a: 1,
          k: [
            kf3(0, [100, 100, 0]),
            kf3(30, [112, 92, 0], false),
            kf3(60, [90, 106, 0], false),
            kf3(90, [100, 100, 0], false),
          ],
        },
        a: { a: 0, k: [0, 0, 0] },
        s: staticScale,
      },
      [
        grp([el(96, 96), st(10, PRIMARY), tr()], "lens"),
        grp([rc(64, 64, 44, 14, 45), fl(SOFT), tr()], "handle"),
      ],
    ),
  ],
  "welcome-search",
);

mkdirSync("src/assets/lottie", { recursive: true });
writeFileSync("src/assets/lottie/welcome-1.json", JSON.stringify(welcome1));
writeFileSync("src/assets/lottie/welcome-2.json", JSON.stringify(welcome2));
writeFileSync("src/assets/lottie/welcome-3.json", JSON.stringify(welcome3));
console.log("Lottie écrits");
