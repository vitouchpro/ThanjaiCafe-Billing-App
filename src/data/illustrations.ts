/* ============================================================
   Product illustrations.

   Each product gets a bold, flat, animated SVG icon rather than a stock
   photo — closer to how a food-delivery app (Swiggy/Zomato) renders a menu
   item with no photo: thick outlines, a few saturated colour blocks, and
   minimal texture instead of fussy shading. They render offline, weigh a
   few hundred bytes, animate on their own (a light pop-in on load, plus a
   slow steam/shimmer loop for hot and cold drinks), and stay visually
   consistent across the whole menu.

   This set is the default image for every seeded product — see
   `productImage()` below and `defaults.ts`, which tries an illustration
   before falling back to a bundled photo. A shop can still replace any one
   of them with a real photo through Add/Edit Product.

   Everything is built from a small set of shared vessels (tumbler, cup,
   plate, glass) so 28 items read as one set instead of 28 clip-art picks.
   ============================================================ */

/** Bold, food-appropriate palette. Kept small on purpose — a wider palette
    makes the grid look like clip art rather than a menu. Pushed a shade
    more saturated than a photoreal palette so small icons stay legible. */
const C = {
  coffee: '#3b2210',
  coffeeLight: '#8a5228',
  crema: '#d9a562',
  milk: '#f7ecd9',
  tea: '#b8621a',
  teaLight: '#dd9430',
  green: '#6b9a35',
  steel: '#c3c9d1',
  steelDark: '#7c838e',
  steelLight: '#eef0f3',
  fried: '#d9741f',
  friedDark: '#a6540f',
  friedLight: '#f0a545',
  batter: '#faf3e2',
  batterShade: '#e8d9b8',
  plate: '#eef1f4',
  plateEdge: '#ccd3da',
  chutney: '#dff0d4',
  sambar: '#d8551c',
  sweet: '#f0b52e',
  sweetDark: '#c98816',
  jaggery: '#8a5218',
  ragi: '#6d4a2e',
  ragiLight: '#8f6a45',
  leaf: '#4f8a2a',
  glass: '#e4eef4',
  lemon: '#eddb1e',
  banana: '#e6c445',
} as const;

/* ---------------- animation ----------------
   Self-contained CSS, embedded per-SVG so it still animates when the icon
   is used as an `<img src="data:...">` (no external stylesheet needed).
   Every rule lives inside a prefers-reduced-motion guard: with reduced
   motion on, none of these rules exist, so elements simply render at their
   normal static attributes — never stuck mid-animation or invisible. */

/** Entrance pop, applied to every icon's whole art group. */
const STYLE_POP = `<style>@media (prefers-reduced-motion:no-preference){.ap{transform-origin:50px 58px;animation:kp .45s cubic-bezier(.34,1.56,.64,1) both}@keyframes kp{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}}</style>`;

/** Slow rise-and-fade loop for the steam wisps on hot drinks. */
const STYLE_STEAM = `<style>@media (prefers-reduced-motion:no-preference){.as{animation:ks 2.2s ease-in-out infinite}@keyframes ks{from{opacity:.18;transform:translateY(2px)}to{opacity:.65;transform:translateY(-7px)}}}</style>`;

/** Slow highlight shimmer on cold-glass drinks. */
const STYLE_SHIMMER = `<style>@media (prefers-reduced-motion:no-preference){.ah{animation:kh 2.6s ease-in-out infinite}@keyframes kh{from{opacity:.2}to{opacity:.75}}}</style>`;

/* ---------------- shared vessels ---------------- */

/** Stainless davara tumbler — how filter coffee is actually served. */
const tumbler = (liquid: string, foam = true): string => `
  <ellipse cx="50" cy="84" rx="26" ry="6" fill="${C.steel}"/>
  <path d="M24 82h52a4 4 0 0 1-4 5H28a4 4 0 0 1-4-5z" fill="${C.steelDark}" opacity=".55"/>
  <ellipse cx="50" cy="81" rx="26" ry="6" fill="${C.steelLight}"/>
  <ellipse cx="50" cy="81" rx="26" ry="6" fill="none" stroke="${C.steelDark}" stroke-width="1.6"/>

  <path d="M35 32h30l-3.5 40a7 7 0 0 1-7 6H45.5a7 7 0 0 1-7-6z" fill="${C.steel}"/>
  <path d="M40 34h9l-2.6 42h-3.8z" fill="${C.steelLight}" opacity=".85"/>
  <path d="M60 34h3l-2.4 42h-2z" fill="#fff" opacity=".35"/>
  <path d="M35 32h30l-3.5 40a7 7 0 0 1-7 6H45.5a7 7 0 0 1-7-6z" fill="none" stroke="${C.steelDark}" stroke-width="2.2"/>

  <ellipse cx="50" cy="32" rx="15" ry="4" fill="${liquid}"/>
  ${foam ? `<ellipse cx="50" cy="31.4" rx="12" ry="3" fill="${C.milk}" opacity=".9"/>` : ''}
  <ellipse cx="50" cy="32" rx="15" ry="4" fill="none" stroke="${C.steelDark}" stroke-width="2.2"/>`;

/** Ceramic cup with handle — tea. */
const cup = (liquid: string): string => `
  <path d="M69 44h6a10 10 0 0 1 0 20h-4" fill="none" stroke="${C.steelDark}" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M28 38h44l-3.5 34a9 9 0 0 1-9 8H40.5a9 9 0 0 1-9-8z" fill="#fdfbf7"/>
  <path d="M28 38h44l-1.2 11H29.2z" fill="${liquid}"/>
  <ellipse cx="50" cy="38.6" rx="21.6" ry="3.6" fill="${liquid}"/>
  <ellipse cx="50" cy="38.6" rx="21.6" ry="3.6" fill="none" stroke="${C.steelDark}" stroke-width="1.6" opacity=".55"/>
  <path d="M28 38h44l-3.5 34a9 9 0 0 1-9 8H40.5a9 9 0 0 1-9-8z" fill="none" stroke="${C.steelDark}" stroke-width="2.1"/>
  <ellipse cx="50" cy="86" rx="22" ry="4" fill="${C.plateEdge}" opacity=".6"/>`;

/** Tall glass — cold drinks and malts. Highlight shimmers on a loop. */
const glass = (liquid: string, straw = false): string => STYLE_SHIMMER + `
  <path d="M33 24h34l-4 56a8 8 0 0 1-8 7H45a8 8 0 0 1-8-7z" fill="${C.glass}" opacity=".55"/>
  <path d="M35.4 34h29.2l-3 46a7 7 0 0 1-7 6H45.4a7 7 0 0 1-7-6z" fill="${liquid}"/>
  <ellipse cx="50" cy="34" rx="14.6" ry="3" fill="${liquid}" opacity=".7"/>
  ${straw ? `<path d="M58 18l-5 34" stroke="#e05c5c" stroke-width="4.4" stroke-linecap="round"/>` : ''}
  <path d="M33 24h34l-4 56a8 8 0 0 1-8 7H45a8 8 0 0 1-8-7z" fill="none" stroke="${C.steelDark}" stroke-width="2"/>
  <path class="ah" d="M40 30l2 50" stroke="#fff" stroke-width="3" opacity=".55" stroke-linecap="round"/>`;

/** Round plate seen at a slight angle — tiffin and snack items sit on this. */
const plate = (): string => `
  <ellipse cx="50" cy="62" rx="40" ry="20" fill="${C.plateEdge}"/>
  <ellipse cx="50" cy="59.5" rx="40" ry="20" fill="${C.plate}"/>
  <ellipse cx="50" cy="59.5" rx="31" ry="14.6" fill="#fff" opacity=".65"/>`;

/** Small accompaniment bowls — chutney and sambar beside a tiffin item. */
const sides = (): string => `
  <ellipse cx="21" cy="55" rx="10" ry="5" fill="${C.plateEdge}"/>
  <ellipse cx="21" cy="54" rx="9" ry="4.4" fill="${C.chutney}"/>
  <ellipse cx="79" cy="55" rx="10" ry="5" fill="${C.plateEdge}"/>
  <ellipse cx="79" cy="54" rx="9" ry="4.4" fill="${C.sambar}"/>`;

/** Rising steam — signals a hot item, drifts up and fades on a loop. */
const steam = (x = 50): string => STYLE_STEAM + `
  <g class="as" opacity=".5" stroke="#a9b4bd" stroke-width="3" stroke-linecap="round" fill="none">
    <path d="M${x - 9} 20c-3-5 3-8 0-13"/>
    <path d="M${x} 16c-3-5 3-8 0-13"/>
    <path d="M${x + 9} 20c-3-5 3-8 0-13"/>
  </g>`;

/* ---------------- per-product art ---------------- */

const ART: Record<string, string> = {
  /* --- Coffee --- */
  'Filter Coffee': steam() + tumbler(C.coffeeLight),
  'Sukku Coffee': steam() + tumbler('#7a4a25') + `
    <circle cx="76" cy="72" r="7" fill="${C.jaggery}"/>
    <path d="M72 72h8M76 68v8" stroke="#6b4520" stroke-width="1.8" stroke-linecap="round"/>`,
  'Black Coffee': steam() + tumbler(C.coffee, false),
  'Badam Milk': `
    ${glass('#f3e2c8')}
    <ellipse cx="44" cy="44" rx="3.4" ry="4.6" fill="#d9b98c" transform="rotate(-18 44 44)"/>
    <ellipse cx="55" cy="52" rx="3.4" ry="4.6" fill="#d9b98c" transform="rotate(22 55 52)"/>
    <ellipse cx="49" cy="64" rx="3.4" ry="4.6" fill="#d9b98c" transform="rotate(-8 49 64)"/>`,
  'Cold Coffee': `
    ${glass('#8a5c39', true)}
    <ellipse cx="50" cy="34" rx="13" ry="3.4" fill="${C.milk}" opacity=".9"/>
    <rect x="41" y="42" width="9" height="9" rx="2" fill="#fff" opacity=".55"/>
    <rect x="53" y="56" width="8" height="8" rx="2" fill="#fff" opacity=".45"/>`,

  /* --- Tea --- */
  'Masala Tea': steam() + cup(C.tea) + `
    <circle cx="44" cy="40" r="1.8" fill="#8a5320"/>
    <circle cx="56" cy="42" r="1.6" fill="#8a5320"/>`,
  'Ginger Tea': steam() + cup(C.teaLight) + `
    <path d="M70 74c5-3 9-1 11 2-4 3-9 2-11-2z" fill="${C.jaggery}"/>`,
  'Green Tea': steam() + cup('#a9c07a') + `
    <path d="M66 72c6-6 13-5 16-2-3 6-11 7-16 2z" fill="${C.leaf}"/>
    <path d="M68 71c5-2 9-2 12-1" stroke="#3f6b28" stroke-width="1.4" fill="none"/>`,
  'Lemon Tea': steam() + cup('#d9a34e') + `
    <circle cx="72" cy="44" r="8" fill="${C.lemon}"/>
    <circle cx="72" cy="44" r="8" fill="none" stroke="#c4b02f" stroke-width="1.6"/>
    <path d="M72 36v16M64 44h16" stroke="#f5efb0" stroke-width="1.3"/>`,

  /* --- Snacks --- */
  // Crisp rimmed edge — a medhu vadai, not a donut. Texture trimmed to one
  // accent cluster so the silhouette reads bold rather than busy.
  'Vadai': plate() + `
    <circle cx="50" cy="52" r="21" fill="${C.fried}"/>
    <circle cx="50" cy="52" r="21" fill="none" stroke="${C.friedDark}" stroke-width="2.6"/>
    <circle cx="50" cy="52" r="16" fill="none" stroke="${C.friedDark}" stroke-width="1.3" opacity=".4"/>
    <circle cx="50" cy="52" r="5.5" fill="${C.plate}"/>
    <circle cx="50" cy="52" r="5.5" fill="none" stroke="${C.friedDark}" stroke-width="2.2"/>
    <g fill="${C.friedLight}" opacity=".75">
      <ellipse cx="41" cy="45" rx="4" ry="2.6" transform="rotate(-28 41 45)"/>
      <circle cx="60" cy="59" r="2.2"/>
    </g>`,
  'Thattai': plate() + `
    <circle cx="50" cy="52" r="22" fill="${C.friedLight}"/>
    <circle cx="50" cy="52" r="22" fill="none" stroke="${C.friedDark}" stroke-width="2.6"/>
    <g fill="${C.friedDark}" opacity=".6">
      <circle cx="43" cy="46" r="2"/><circle cx="56" cy="45" r="1.8"/>
      <circle cx="50" cy="55" r="2"/><circle cx="42" cy="58" r="1.7"/>
    </g>`,
  // Craggy fried surface — bondas are lumpy, not billiard balls.
  'Bonda': plate() + `
    <path d="M41 38c9 0 16 6 16 14s-7 15-16 15-16-7-16-15 7-14 16-14z" fill="${C.fried}"/>
    <path d="M41 38c9 0 16 6 16 14s-7 15-16 15-16-7-16-15 7-14 16-14z" fill="none" stroke="${C.friedDark}" stroke-width="2.3"/>
    <path d="M64 43c7.6 0 13.6 5 13.6 12s-6 12.6-13.6 12.6-13.6-5.6-13.6-12.6 6-12 13.6-12z" fill="${C.friedLight}"/>
    <path d="M64 43c7.6 0 13.6 5 13.6 12s-6 12.6-13.6 12.6-13.6-5.6-13.6-12.6 6-12 13.6-12z" fill="none" stroke="${C.friedDark}" stroke-width="2.3"/>
    <ellipse cx="35" cy="46" rx="4.6" ry="3" fill="#e5ae74" opacity=".8" transform="rotate(-25 35 46)"/>`,
  'Murukku': plate() + `
    <g fill="none" stroke="${C.fried}" stroke-width="6" stroke-linecap="round">
      <circle cx="50" cy="52" r="18"/><circle cx="50" cy="52" r="11"/><circle cx="50" cy="52" r="4.5"/>
    </g>
    <g fill="none" stroke="${C.friedDark}" stroke-width="1.2" opacity=".5">
      <circle cx="50" cy="52" r="18"/><circle cx="50" cy="52" r="11"/>
    </g>`,
  // Battered slices, one showing the pale banana inside.
  'Banana Bajji': plate() + `
    <g stroke="${C.friedDark}" stroke-width="2.1">
      <path d="M33 38c6-3 12 0 14 7s-1 15-7 17-11-2-12-9 -1-12 5-15z" fill="${C.friedLight}"/>
      <path d="M55 42c6-2 12 1 13 8s-2 14-8 15-10-3-11-10 0-11 6-13z" fill="${C.fried}"/>
    </g>
    <path d="M58 47c3-1 6 1 6.4 5s-1 7-4 7.6-5-1.6-5.4-5.4.6-6.2 3-7.2z" fill="${C.banana}" opacity=".9"/>`,
  'Samosa': plate() + `
    <path d="M50 30l22 34H28z" fill="${C.friedLight}"/>
    <path d="M50 30l22 34H28z" fill="none" stroke="${C.friedDark}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M50 30v34" stroke="${C.friedDark}" stroke-width="1.6" opacity=".5"/>`,

  /* --- Tiffin --- */
  'Idli (2 pcs)': plate() + sides() + `
    <ellipse cx="42" cy="50" rx="16" ry="12" fill="${C.batter}"/>
    <ellipse cx="42" cy="50" rx="16" ry="12" fill="none" stroke="${C.batterShade}" stroke-width="2.2"/>
    <ellipse cx="59" cy="56" rx="15" ry="11" fill="#fffdf8"/>
    <ellipse cx="59" cy="56" rx="15" ry="11" fill="none" stroke="${C.batterShade}" stroke-width="2.2"/>`,
  'Pongal': plate() + sides() + `
    <path d="M30 56c0-11 9-19 20-19s20 8 20 19c0 5-9 8-20 8s-20-3-20-8z" fill="#f2e2b8"/>
    <path d="M30 56c0-11 9-19 20-19s20 8 20 19" fill="none" stroke="#dcc98f" stroke-width="2.2"/>
    <circle cx="43" cy="46" r="2.4" fill="#c98a3a"/>
    <circle cx="49" cy="42" r="2" fill="#6b8c3f"/>`,
  // Golden rolled dosa with the potato masala spilling from the open end.
  'Masala Dosa': plate() + sides() + `
    <path d="M30 58c0-6 3.4-9.4 8-9.4h26c4.6 0 8 3.4 8 9.4s-3.4 9.4-8 9.4H38c-4.6 0-8-3.4-8-9.4z" fill="${C.fried}"/>
    <path d="M34 51c8-2 20-2 28 0" stroke="${C.friedLight}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/>
    <path d="M30 58c0-6 3.4-9.4 8-9.4h26c4.6 0 8 3.4 8 9.4s-3.4 9.4-8 9.4H38c-4.6 0-8-3.4-8-9.4z" fill="none" stroke="${C.friedDark}" stroke-width="2.3"/>
    <ellipse cx="64" cy="58" rx="6" ry="9.4" fill="#e0a63f"/>
    <ellipse cx="64" cy="58" rx="6" ry="9.4" fill="none" stroke="${C.friedDark}" stroke-width="2"/>
    <g fill="#c8871f" opacity=".8">
      <circle cx="63" cy="55" r="1.9"/><circle cx="66" cy="60" r="1.7"/>
    </g>`,
  // Rolled cylinder — the plain dosa is served rolled rather than folded.
  'Plain Dosa': plate() + sides() + `
    <path d="M28 60c0-5 3-8 7-8h30c4 0 7 3 7 8s-3 8-7 8H35c-4 0-7-3-7-8z" fill="${C.batter}"/>
    <path d="M28 60c0-5 3-8 7-8h30c4 0 7 3 7 8s-3 8-7 8H35c-4 0-7-3-7-8z" fill="none" stroke="${C.batterShade}" stroke-width="2.3"/>
    <ellipse cx="35" cy="60" rx="5" ry="8" fill="#fffdf6"/>
    <ellipse cx="35" cy="60" rx="5" ry="8" fill="none" stroke="${C.batterShade}" stroke-width="2"/>`,
  // Turned out from a cup — a flat-topped cylinder rather than a dome.
  'Upma': plate() + `
    <path d="M33 44h34l-3 16c0 3-6 4.6-14 4.6s-14-1.6-14-4.6z" fill="#efe3c6"/>
    <ellipse cx="50" cy="44" rx="17" ry="5.4" fill="#f7ecd4"/>
    <path d="M33 44h34l-3 16c0 3-6 4.6-14 4.6s-14-1.6-14-4.6z" fill="none" stroke="#d9c79b" stroke-width="2.2"/>
    <ellipse cx="50" cy="44" rx="17" ry="5.4" fill="none" stroke="#d9c79b" stroke-width="2.1"/>
    <circle cx="44" cy="43" r="2.1" fill="${C.leaf}"/>
    <circle cx="56" cy="45" r="1.9" fill="#d4802f"/>`,
  // Puffed domes with a pinched seam — a poori is inflated, not flat.
  'Poori (2 pcs)': plate() + sides() + `
    <path d="M26 54c0-11 8-19 18-19s18 8 18 19c0 4-8 6-18 6s-18-2-18-6z" fill="${C.friedLight}"/>
    <path d="M26 54c0-11 8-19 18-19s18 8 18 19c0 4-8 6-18 6s-18-2-18-6z" fill="none" stroke="${C.friedDark}" stroke-width="2.2"/>
    <path d="M50 60c0-9 6-15 14-15s14 6 14 15c0 3.4-6 5-14 5s-14-1.6-14-5z" fill="#e8b26f"/>
    <path d="M50 60c0-9 6-15 14-15s14 6 14 15c0 3.4-6 5-14 5s-14-1.6-14-5z" fill="none" stroke="${C.friedDark}" stroke-width="2.2"/>`,

  /* --- Sweets --- */
  'Mysore Pak': plate() + `
    <g stroke="${C.sweetDark}" stroke-width="2.2">
      <rect x="30" y="42" width="21" height="17" rx="2.5" fill="${C.sweet}"/>
      <rect x="52" y="46" width="20" height="16" rx="2.5" fill="#f0c25e"/>
    </g>`,
  // Lobed flower shape — deliberately unlike murukku's plain spiral.
  'Jangiri': plate() + `
    <g fill="#e0642c" stroke="#c14f1f" stroke-width="1.7">
      <circle cx="50" cy="36" r="7.5"/><circle cx="63" cy="45" r="7.5"/>
      <circle cx="58" cy="60" r="7.5"/><circle cx="42" cy="60" r="7.5"/>
      <circle cx="37" cy="45" r="7.5"/>
    </g>
    <circle cx="50" cy="50" r="8.5" fill="#f08a4b" stroke="#c14f1f" stroke-width="1.7"/>
    <circle cx="50" cy="50" r="3.4" fill="${C.plate}"/>`,
  // A cut wedge with a clean edge — kesari is set and sliced.
  'Rava Kesari': plate() + `
    <path d="M30 62l14-24h22l-8 24z" fill="#f0a93c"/>
    <path d="M44 38h22l-4 6H41z" fill="#f7c469"/>
    <path d="M30 62l14-24h22l-8 24z" fill="none" stroke="#c07f18" stroke-width="2.2" stroke-linejoin="round"/>
    <ellipse cx="46" cy="50" rx="3.2" ry="2.2" fill="#f6e2bc" transform="rotate(-20 46 50)"/>`,

  /* --- Millet specials --- */
  // A flat griddled disc with charred spots — adai is pressed, not scooped.
  'Ragi Adai': plate() + `
    <ellipse cx="50" cy="53" rx="25" ry="15" fill="${C.ragi}"/>
    <ellipse cx="50" cy="51.5" rx="25" ry="15" fill="${C.ragiLight}"/>
    <ellipse cx="50" cy="51.5" rx="25" ry="15" fill="none" stroke="#61503f" stroke-width="2.3"/>
    <g fill="#5f4c3b" opacity=".55">
      <ellipse cx="41" cy="47" rx="3.4" ry="2.2"/><ellipse cx="58" cy="50" rx="3" ry="2"/>
    </g>`,
  // Steamed conical dumplings with a pinched peak.
  'Kambu Kozhukattai': plate() + `
    <g stroke="#6d5c48" stroke-width="2.1">
      <path d="M32 61c0-12 5-22 11-22s11 10 11 22c0 3-5 4-11 4s-11-1-11-4z" fill="#9c8873"/>
      <path d="M53 63c0-10 4-18 9-18s9 8 9 18c0 2.6-4 3.6-9 3.6s-9-1-9-3.6z" fill="#8d7a63"/>
    </g>
    <path d="M43 39c1-3 2-4 2-6M62 45c.8-2.4 1.6-3.4 1.6-5" stroke="#6d5c48" stroke-width="1.9" fill="none" stroke-linecap="round"/>`,
  'Millet Bonda': plate() + `
    <path d="M42 39c8.4 0 15 5.6 15 13s-6.6 14-15 14-15-6.6-15-14 6.6-13 15-13z" fill="#9c8266"/>
    <path d="M42 39c8.4 0 15 5.6 15 13s-6.6 14-15 14-15-6.6-15-14 6.6-13 15-13z" fill="none" stroke="#7a6450" stroke-width="2.2"/>
    <path d="M63 45c7 0 12.6 4.6 12.6 11s-5.6 11.6-12.6 11.6-12.6-5.2-12.6-11.6 5.6-11 12.6-11z" fill="#ad9278"/>
    <path d="M63 45c7 0 12.6 4.6 12.6 11s-5.6 11.6-12.6 11.6-12.6-5.2-12.6-11.6 5.6-11 12.6-11z" fill="none" stroke="#7a6450" stroke-width="2.2"/>
    <ellipse cx="36" cy="47" rx="4.2" ry="2.8" fill="#bda88c" opacity=".8" transform="rotate(-25 36 47)"/>`,
  'Ragi Malt': `
    ${glass('#8a7460')}
    <ellipse cx="50" cy="34" rx="13" ry="3.2" fill="#c3ad94" opacity=".9"/>
    <circle cx="45" cy="50" r="1.9" fill="#6d5b4a" opacity=".7"/>
    <circle cx="55" cy="60" r="1.7" fill="#6d5b4a" opacity=".7"/>`,
};

/** Soft category-tinted backdrop, so a grid of cards has gentle rhythm
    instead of 28 identical white squares. */
const BACKDROP: Record<string, [string, string]> = {
  'cat-coffee': ['#f6ece0', '#eddcc8'],
  'cat-tea': ['#eef2e6', '#dfe8d2'],
  'cat-snacks': ['#fdf0dd', '#f7e2c4'],
  'cat-tiffin': ['#eef4f9', '#dce7f0'],
  'cat-sweets': ['#fdf1dc', '#f9e4bd'],
  'cat-millet': ['#f2ede6', '#e6ddd1'],
};

const FALLBACK_BACKDROP: [string, string] = ['#f3efe9', '#e7e0d6'];

/**
 * Returns a data-URI SVG icon for a product, or undefined when there is no
 * drawing for that name (a product the shop added themselves). The art
 * itself pops in on load and, for hot/cold drinks, keeps a slow steam or
 * shimmer loop going — all through CSS embedded in the SVG, so it animates
 * even rendered as a plain `<img>`.
 */
export function productImage(name: string, categoryId: string): string | undefined {
  const art = ART[name];
  if (!art) return undefined;

  const [from, to] = BACKDROP[categoryId] ?? FALLBACK_BACKDROP;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="300" height="300">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="100" fill="url(#b)"/>` +
    STYLE_POP +
    `<g class="ap">${art}</g>` +
    `</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' '))}`;
}

export const hasIllustration = (name: string): boolean => name in ART;

/** Every illustrated product name — used by tests and the seed data. */
export const ILLUSTRATED_PRODUCTS = Object.keys(ART);
