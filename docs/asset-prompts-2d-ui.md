# BeriGame 2D + UI asset prompts (GPT Image 2.5)

Phase 1 of the asset overhaul: every 2D image and UI surface in `frontend/`.
3D models, the sand/ocean materials and animations are a later phase.

## 1. Model and settings

As of September 2026 the newest OpenAI image models are the GPT Image 2.5 pair
(released 2026-09-08), both available in the API:

| Model ID | Use it for |
| --- | --- |
| `gpt-image-2.5-sunburst` | Finals, and anything edited from a reference image (OpenAI positions it for "editing precision"). Slower. |
| `gpt-image-2.5-flare` | Cheap, fast drafts to explore a look before committing. |

`gpt-image-2` (April 2026) still works and is the fallback if 2.5 is not enabled on the account.

Parameters that matter for game assets (from the image generation guide):

- `background: "transparent"` with `output_format: "png"` (or `webp`). Use for every icon, frame and FX sprite.
- `size`: `1024x1024`, `1536x1024`, `1024x1536`, or any custom `WxH` where both are multiples of 16, aspect ratio is between 1:3 and 3:1, the longest edge is at most 3840 and total pixels are between 655,360 and 8,294,400. So `1024x1024` is the practical minimum for an icon (downscale afterwards) and `3840x2160` is the maximum for the sky.
- `quality`: `low | medium | high | xhigh | max | auto`. Draft at `low` on flare, finalise at `high` on sunburst. `xhigh`/`max` are only worth it for the key art and sky.
- `n`: ask for 4 per prompt and pick.
- `/v1/images/edits` accepts several input images. This is how the set is kept consistent: every request after the first passes the style anchor (section 3) as a reference image.

Pricing for 2.5 was not in the docs pages I could read; check the pricing page before a batch run.

### Route B: no API key, via Codex (ChatGPT login)

Codex CLI (v0.123.0 or newer) has a built-in image tool that is billed against
the ChatGPT subscription instead of API credits. It only works with ChatGPT
auth (`codex login`, ChatGPT flow), not with an API key.

```bash
codex exec -C "$(pwd)" -s workspace-write --skip-git-repo-check \
  --image docs/art/style-anchor.png \
  '$imagegen <prompt text>'
```

The PNG lands in `~/.codex/generated_images/<session-id>/ig_*.png`; copy it out
from there. `--image` can be repeated for several reference images, which is
how the style anchor is passed.

Two community wrappers do the copy-out and batching:
[yazelin/codex-imagegen-skill](https://github.com/yazelin/codex-imagegen-skill)
(a Claude Code skill: `codex-imagegen.sh "prompt" out.png [ref.png ...]`, 1 to 16
references; documented for Linux, macOS and WSL, so on this Windows machine run
it from Git Bash or WSL) and
[jdmnk/codex-imagegen-cli](https://github.com/jdmnk/codex-imagegen-cli)
(Python, adds `--size`, `--quality low|medium|high`, `--n` and a JSONL `batch`
command by calling the Codex backend directly).

What is different from the API route:

| | API route | Codex route |
| --- | --- | --- |
| Model | `gpt-image-2.5-sunburst` / `-flare` selectable | Not selectable. The request is pinned to `gpt-image-2`; whether ChatGPT serves 2.5 behind it is unconfirmed. |
| `background: "transparent"` | Supported | **Rejected by the Codex backend.** Use the chroma-key workaround below. |
| `quality` | up to `max` | `low`, `medium`, `high` (jdmnk CLI only; plain `$imagegen` has no flag, so state it in the prompt) |
| `size` | parameter | parameter in the jdmnk CLI; otherwise say "square 1:1" / "16:9 landscape" in the prompt |
| Cost | per image | subscription quota; edits with reference images hit a per-minute input-image limit, so pace the batch |
| Stability | documented API | unofficial use of Codex internals; may break on a Codex update. Personal use only. |

**Chroma-key workaround for transparency.** In every prompt that says
"Transparent background", replace that sentence with:

```
Background: a perfectly flat, uniform, solid magenta (#FF00FF) filling the
whole canvas, with no gradient, no shadow, no vignette and no texture. No
magenta or pink anywhere on the subject itself.
```

Then key the magenta out locally (ImageMagick: `magick in.png -fuzz 18%
-transparent "#FF00FF" out.png`, followed by a 1px alpha erode to remove the
fringe). This art style suits keying well because every subject is bounded by
a thick dark-brown outline, so the edge pixels are dark brown against magenta
and there is almost no colour spill. Nothing in the palette is close to
magenta; the violet Grab icon (#8B5CF6) is far enough away at 18% fuzz, but
check that one by eye. For the soft-edged FX sprites (heal sparkles, dust)
keying is rougher: generate those on flat black instead and use
`mix-blend-mode: screen` in CSS, or use `rembg`.

### Pipeline rules

1. Never bake text into an asset. All labels, numbers and key hints stay as HTML text so they localise and stay sharp. The logo wordmark is the only exception.
2. Generate at 1024 and downscale. Icons ship at 128x128 (displayed at 32 to 64 CSS px); panels ship at 512x512 for 9-slice.
3. One subject per image, centred, with about 12% padding. Sprite sheets from image models have uneven cell spacing; do not try to slice them.
4. After generation: trim, downscale with Lanczos, run through `pngquant`/`oxipng`, export WebP for anything over about 20 KB.
5. Test every icon at 32px on both sand (`#fff1a1`) and ocean (`#006994`) before accepting it. If the silhouette does not read, regenerate; do not fix it in CSS.

## 2. Audit: what exists today

| Surface | Today | Problem |
| --- | --- | --- |
| Berry icons (`public/*berry.svg`) | Five identical 461-byte SVGs: two circles, three dots, a leaf. Only the fill colour differs. | Blueberry, strawberry, greenberry and goldberry have the same silhouette. Goldberry (heals 10) looks no more valuable than greenberry (heals 2). |
| Stance icons (`StanceBadge.tsx`) | Emoji: 👊 ✋ 🛡️ | Render differently on Windows, macOS and Android. They are the core combat read and appear above every head at 18px. |
| Stance HUD (`.stance-hud`) | Black 60% box, white 12% buttons, yellow active border, HP as the text "HP 30/30". | No HP bar on the HUD at all. No visual link to the RPS triangle (what beats what is only in a tooltip). |
| Inventory (`.inventory`, `.inventory-slot`) | Flat translucent grid. | No slot art, no hover or drag state art, quantity is plain text. |
| Buttons (Inventory / Chat, `.ui-element`) | Browser-default grey buttons. | The most visibly unstyled element on screen. |
| Context menu (`.click-dropdown`) | Stack of plain buttons with yellow target name. | No action icons (Attack, Harvest, Pick up). |
| World-space health bar (`.health-bar`) | Plain div with a fill. | No frame; hard to see against sand. |
| Chat bubble, ground item label, toast, harvest progress | Translucent black boxes. 💀 emoji on death drops. | Emoji again; nothing ties them to a theme. |
| Damage numbers / CLASH / COUNTER | 24px bold sans with text shadow. | Fine as text, but needs a display font and an impact sprite behind it. |
| Loading screen | Blue CSS gradient, text title, five CSS circles, 💡🌳💬 emoji tips. | No key art, no logo. |
| Logo (`public/logo.png`, favicon) | Teal-to-green gradient cube mark. | Generic; nothing about berries, an island or fighting. |
| Sky (`public/sky.jpg`, CSS body background) | Photographic dusk gradient, 5760x3840, 256 KB. | Photoreal gradient behind low-poly models; empty (no clouds, no horizon interest). |
| `public/kick.png` | 422 bytes, not referenced anywhere in `src/`. | Dead file; delete. |
| Font | `font-family: sans-serif` everywhere. | Not an image task, but pick a display font (for example Baloo 2 or Lilita One) plus a UI font before judging any of the art. |

## 3. Art direction and the style anchor

The 3D world is flat-shaded low-poly: pale sand island, deep teal ocean, pine-like berry trees, dusk sky. The UI should look like it was made on that island.

**Direction: "carved driftwood and berry juice".** Panels are sun-bleached driftwood planks lashed with palm cord; inset areas are woven palm mat; accents are the four berry colours. Icons are chunky, hand-painted, thick dark outline, top-left light, two-step cel shading, no gradients finer than that, no photorealism.

Palette (use these hex values verbatim in prompts):

- Driftwood light `#E8D5B0`, driftwood dark `#8A6A45`, outline `#2B1D14`
- Sand `#FFF1A1`, ocean `#006994`, palm green `#3E8E41`
- Blueberry `#4F46E5`, strawberry `#EF4444`, greenberry `#22C55E`, goldberry `#F59E0B`
- Advantage `#4CAF50`, disadvantage `#F44336`, active/selected `#FFEB3B`

### STYLE block

Paste this at the top of **every** prompt below (it is referred to as `{STYLE}`):

```
STYLE: Hand-painted 2D game UI asset for a cheerful low-poly tropical island
brawler. Chunky, toy-like shapes with a thick uniform dark-brown outline
(#2B1D14), two-step cel shading, a single soft highlight from the top-left,
and flat saturated colour. No photorealism, no fine texture noise, no
gradients beyond the two shading steps, no drop shadow on the ground, no
text, no letters, no numbers, no watermark, no border around the canvas.
Subject centred, fully inside the frame with about 12% empty padding on all
sides, viewed straight on. Transparent background.
```

### Prompt 0: the style anchor (generate first, reuse as reference everywhere)

`gpt-image-2.5-sunburst`, `1536x1024`, `quality: high`, `background: opaque`.

```
{STYLE, but replace "Transparent background" with "Plain warm off-white background (#F7F1E3)"}

A style reference sheet showing six separate objects arranged in a loose
2 x 3 grid with generous space between them, all drawn in exactly the same
style: (1) a plump blueberry (#4F46E5) with a small star-shaped crown,
(2) a clenched fist seen from the front, (3) a round wooden shield with a
palm-cord rim, (4) a square plank of sun-bleached driftwood (#E8D5B0 with
#8A6A45 grain lines) lashed at the corners with palm cord, (5) a small woven
palm-leaf basket, (6) a comic impact starburst in yellow (#FFEB3B) and white.
Consistent outline weight across all six objects. Consistent light direction.
```

Pick the best of 4. Save it as `docs/art/style-anchor.png`. Every prompt below is sent to `/v1/images/edits` with this file as the reference image and this line appended:

```
Match the outline weight, shading steps, palette and brush feel of the
reference sheet exactly. Do not copy any object from the reference; draw only
the subject described.
```

## 4. Item icons

`1024x1024`, transparent, sunburst `high`. Ship as `public/items/<id>.png` at 128x128 and update `icon` in `shared/sim/items.ts`.

The four berries must differ by **silhouette** first and colour second, and perceived value should follow the heal amount (greenberry 2 < strawberry 3 < blueberry 5 < goldberry 10).

**Blueberry**
```
{STYLE}
A single plump blueberry inventory icon. Deep indigo-blue skin (#4F46E5) with
a lighter periwinkle bloom patch (#818CF8) on the upper left, and the
characteristic five-pointed star-shaped crown on top in darker indigo
(#3730A3). Slightly squashed sphere, wider than tall. One tiny green leaf
(#22C55E) tucked behind the right side.
```

**Strawberry**
```
{STYLE}
A single strawberry inventory icon. Classic heart-like strawberry silhouette,
point at the bottom. Bright red skin (#EF4444) with a darker red shade step
(#B91C1C), evenly spaced pale-yellow teardrop seeds, and a jagged five-leaf
green calyx (#22C55E) with a short curved stem on top, tilted about ten
degrees clockwise.
```

**Greenberry** (the cheap, common one)
```
{STYLE}
A small cluster of three unripe green berries on one short forked twig, as an
inventory icon. The berries are small, firm and matte, in fresh green
(#22C55E) with a darker green shade step (#15803D), each with a tiny dark dot
at the tip. The twig is brown (#8A6A45). Deliberately modest and plain: this
is the least valuable fruit in the game.
```

**Goldberry** (the rare one)
```
{STYLE}
A single large, glossy golden berry inventory icon, the rarest fruit in the
game. Teardrop-round shape like a physalis berry, rich amber-gold skin
(#F59E0B) with a bright yellow highlight (#FDE68A) and a deep orange shade
step (#B45309). Four papery pale husk petals peeled open behind it like a
starburst. Three small four-point sparkles around it in white and pale
yellow. It should look clearly more precious than an ordinary berry.
```

**Fallback / unknown item** (replaces `berry.svg`)
```
{STYLE}
A small drawstring pouch made of woven palm leaf, tied with palm cord, slightly
bulging, as a generic "unknown item" inventory icon. Tan and olive weave
(#C9B37E, #8A8A4A). No symbol on it.
```

## 5. Stance icons (the most important set)

These replace the emoji in `STANCE_ICON`. They appear at 22px in the HUD and 18px above every player's head, so they need a bold single-shape silhouette. Fight state (advantage/disadvantage) is already shown by the ring colour in CSS, so the icons themselves are **colour-coded by stance only**: Strike warm red-orange, Grab violet, Guard blue. That gives players a second channel besides shape.

`1024x1024`, transparent, sunburst `high`. Ship as `public/ui/stance-{strike,grab,guard}.png` at 128x128.

**Strike**
```
{STYLE}
A combat stance icon: a clenched right fist punching straight toward the
viewer, knuckles forward, slightly foreshortened, with three short bold speed
lines trailing behind it. The fist is wrapped in red-orange cloth hand wraps
(#F97316 with #C2410C shade). One solid, compact silhouette that still reads
as a fist when shrunk to 18 pixels. No arm beyond the wrist.
```

**Grab**
```
{STYLE}
A combat stance icon: an open right hand seen from the palm side, fingers
spread and curled inward like a claw about to seize something, thumb out to
the side. The hand is wrapped in violet cloth hand wraps (#8B5CF6 with #6D28D9
shade). Two small curved motion arcs near the fingertips suggest a closing
grip. One solid silhouette that still reads as a grabbing hand at 18 pixels.
No arm beyond the wrist.
```

**Guard**
```
{STYLE}
A combat stance icon: a round wooden buckler shield seen from the front, made
of driftwood planks (#E8D5B0, #8A6A45) with a bold blue painted face
(#3B82F6 with #1D4ED8 shade), a raised round boss in the centre and a rim
lashed with palm cord. Perfectly circular, heavy and solid. It must still
read as a shield at 18 pixels. No hand or arm visible.
```

**RPS triangle diagram** (for the loading screen and a future help panel; `1024x1024`)
```
{STYLE}
A circular "what beats what" diagram with three icons placed at the corners of
an equilateral triangle: a red-orange wrapped fist at the top, a violet
grabbing hand at the bottom right, a blue round shield at the bottom left.
Three thick curved arrows in driftwood brown (#8A6A45) run clockwise between
them: from the fist to the hand, from the hand to the shield, from the shield
to the fist. Arrowheads are large and unambiguous. Nothing in the centre.
```
Pass the three finished stance icons as additional reference images so the diagram reuses them.

## 6. HUD and panel kit (9-slice)

All of these are frames with an **empty, flat centre** so they can be used with CSS `border-image` (9-slice). Generate at `1024x1024`, ship at 512x512, slice at 25%.

The key phrase for sliceable art is: *corners carry the decoration, the four edges are straight and uniform along their length, the centre is one flat colour.*

**Main panel** (inventory, chat, context menu, toast)
```
{STYLE}
A square UI panel frame designed for 9-slice scaling. The border is made of
four sun-bleached driftwood planks (#E8D5B0 with #8A6A45 grain), about 10% of
the canvas thick, lashed together at each of the four corners with wrapped
palm cord. Each edge is perfectly straight and visually uniform along its
whole length so it can be stretched. The entire centre area is one flat,
untextured dark brown (#2B1D14) at full opacity. Symmetrical left to right and
top to bottom. Fills the canvas edge to edge with no padding.
```
(Set the centre to about 80% opacity in CSS rather than in the image.)

**Inventory slot, empty**
```
{STYLE}
A single square inventory slot designed for a grid. A shallow recessed tray
with a thin driftwood rim (#8A6A45) and a woven palm-mat floor in muted tan
(#C9B37E) drawn with a simple large basket-weave pattern, subtly darker at the
top-left inner edge to suggest depth. Flat and quiet so an item icon placed on
top stays readable. Fills the canvas edge to edge with no padding.
```

**Inventory slot, hover / drop target**: same prompt, append
```
The rim glows with a bright yellow (#FFEB3B) inner outline, and the mat floor
is slightly lighter.
```

**Quantity badge**
```
{STYLE}
A small round badge for showing a stack count: a smooth flat river pebble in
dark slate (#334155) with a thin lighter rim, completely blank face.
```

**Button (normal / hover / pressed)** for Inventory, Chat and context-menu rows. `1536x1024` is wasteful here; use `1024x1024` and 9-slice.
```
{STYLE}
A square UI button face designed for 9-slice scaling: a single thick slab of
driftwood (#E8D5B0) with rounded corners, a darker bottom edge (#8A6A45) about
8% tall that reads as the button's thickness, and one small palm-cord knot at
the far left and far right. Edges straight and uniform so it can stretch
horizontally. Centre completely flat and blank. Fills the canvas edge to edge.
```
Hover: append `The slab is slightly brighter with a thin yellow (#FFEB3B) outline.`
Pressed: append `The slab is pushed down: the darker bottom edge is only 2% tall and the face is slightly darker.`

**Stance button, active state ring** (overlays the stance icon when selected)
```
{STYLE}
A square selection frame with rounded corners: a thick bright yellow (#FFEB3B)
rope border with a small knot at the top centre, completely empty and
transparent inside. Fills the canvas edge to edge.
```

**HUD health bar frame** (new: the HUD currently only has "HP 30/30" text). Size `1536x512`: 3:1 is the widest aspect ratio allowed, and 786,432 px clears the 655,360 px minimum.
```
{STYLE}
A long horizontal health bar frame, exactly three times as wide as it is tall.
A hollowed-out bamboo tube seen from the side with a long rectangular window
cut through its full length, showing a completely empty transparent interior.
Bamboo in warm tan (#D6B97B) with darker node rings (#8A6A45) at the two ends.
A small red heart-shaped berry is fixed to the left end cap. The window edges
are perfectly straight. Fills the canvas width.
```
The fill itself stays a CSS div (red to green by percentage) placed behind the frame.

**World-space health bar frame** (above heads, displayed about 48x8 px): same prompt, remove the heart berry and add `Extremely simple: no detail smaller than 5% of the height, because this will be displayed only 8 pixels tall.`

**Chat bubble** (9-slice; the tail is a separate image)
```
{STYLE}
A square speech-bubble body designed for 9-slice scaling: a rounded rectangle
of pale sun-bleached sailcloth (#FBF5E6) with a thick dark-brown outline and a
row of tiny stitched marks along the inside of the border. Centre flat and
blank. No tail. Fills the canvas edge to edge.
```
```
{STYLE}
A small downward-pointing speech-bubble tail: a curved triangular flap of pale
sailcloth (#FBF5E6) with a thick dark-brown outline on its two lower sides
only, open (no outline) along the top edge where it joins a bubble.
```

## 7. Action and status icons

`1024x1024`, transparent, ship at 64x64. One prompt each; all start with `{STYLE}` and `A small UI icon:`.

| File | Replaces | Subject line |
| --- | --- | --- |
| `ui/act-attack.png` | "Attack" row in context menu | `two crossed wrapped fists, one red-orange and one violet, with a small yellow impact star where they meet.` |
| `ui/act-harvest.png` | "Harvest" row | `a hand reaching up to pick a red berry from a leafy green branch.` |
| `ui/act-pickup.png` | "Pick up" row | `an open palm-leaf basket with a downward curved arrow in driftwood brown dropping into it.` |
| `ui/act-walk.png` | future "Walk here" | `two bare footprints in pale sand, one ahead of the other, angled up and to the right.` |
| `ui/act-cancel.png` | Esc / cancel | `a bold X made of two crossed driftwood sticks lashed in the middle with palm cord.` |
| `ui/icon-inventory.png` | "Inventory" button | `a woven palm-leaf satchel with a flap and a wooden toggle, bulging slightly.` |
| `ui/icon-chat.png` | "Chat" button | `a pale sailcloth speech bubble with three dark dots in a row inside it.` |
| `ui/icon-death-drop.png` | 💀 on ground labels | `a friendly cartoon skull, rounded and toy-like, not scary, sitting on a tiny mound of sand.` |
| `ui/tip-move.png` | 💡 loading tip | `a white pointing-hand cursor tapping a patch of sand, with two small ripple rings around the fingertip.` |
| `ui/tip-tree.png` | 🌳 loading tip | `a small low-poly pine-shaped tree with three tiers of foliage and coloured berries dotted on it.` |
| `ui/tip-chat.png` | 💬 loading tip | reuse `icon-chat.png` |
| `ui/state-advantage.png` | "ADVANTAGE" label | `an upward-pointing chevron made of fresh green leaves (#4CAF50), bold and simple.` |
| `ui/state-disadvantage.png` | "DISADVANTAGE" label | `a downward-pointing chevron made of cracked red clay (#F44336), bold and simple.` |

## 8. Combat FX sprites

Shown for about 600ms behind the damage number (`DamageNumber.tsx`), so they must be readable instantly. `1024x1024`, transparent, ship at 256x256. The words HIT / CLASH / COUNTER stay as HTML text on top.

**Hit**
```
{STYLE}
A comic-book impact burst: an irregular eight-point star, bright yellow
(#FFEB3B) core with a white centre and a red-orange (#F97316) outer edge, with
a few small detached triangular shards flying outward. Nothing inside the
burst. Energetic and asymmetrical.
```

**Advantage hit (6 damage + knockback)**: same, append
```
Larger and more violent: twelve points, a double outline, and four curved
speed streaks sweeping to the right to suggest the target being knocked back.
```

**Clash** (same stance, no damage)
```
{STYLE}
A metallic "clang" spark: two short thick wedge shapes in steel grey-blue
(#94A3B8) meeting tip to tip at the centre, with a small white four-point
flash where they touch and six tiny pale-blue sparks scattering sideways.
Cool colours only, no red or yellow: this signals that nobody was hurt.
```

**Counter** (attacker takes 2)
```
{STYLE}
A reversal effect: a bold curved U-turn arrow in violet (#8B5CF6) that comes
in from the left, bends sharply and points back to the left, with a small red
(#F44336) jagged burst at the arrowhead. Reads instantly as "your attack was
turned back on you".
```

**Heal (eating a berry)**
```
{STYLE}
A healing effect: five plus-shaped sparkles of different sizes in fresh green
(#4CAF50) and pale mint, drifting upward in a loose column, with two tiny
leaves among them. Light and gentle, no hard burst shape.
```

**Knockback dust**
```
{STYLE}
A low puff of kicked-up beach sand seen from the side: three overlapping
rounded cloud lobes in pale sand yellow (#FFF1A1) with a tan shade step
(#D9C37A), wider than tall, with a few grains flying off to the right.
```

## 9. Branding

**Logo mark** (replaces the teal cube in `public/logo.png`). `1024x1024`, transparent, sunburst `xhigh`.
```
{STYLE}
A game logo emblem, no text. A plump blueberry (#4F46E5) with a star-shaped
crown, wearing red-orange cloth hand wraps on two tiny cartoon fists raised in
a boxing guard, with a determined, friendly face: two simple oval eyes and a
confident smirk. It stands on a tiny round sand island with a single small
pine-shaped tree behind it. Compact circular composition that fits inside a
circle, bold enough to work as a 32-pixel favicon.
```

**Favicon variant**: run an edit on the chosen logo with
```
Simplify this emblem for use at 16 to 32 pixels: keep only the berry
character's head and two raised wrapped fists, remove the island and tree,
thicken the outline by about 50%, remove the smallest highlights.
```

**Wordmark** (the one place text is generated). `1536x1024`, transparent.
```
{STYLE, but remove "no text, no letters, no numbers"}
A game title wordmark that reads exactly "BeriGame": capital B, lowercase e,
r, i, capital G, lowercase a, m, e. Eight letters, one word, no space. Chunky
rounded display lettering that looks carved from driftwood (#E8D5B0 face,
#8A6A45 sides, #2B1D14 outline) with a slight upward arc. The dot of the
letter "i" is a small blueberry (#4F46E5). A few tiny green leaves sprout from
the top of the "B" and the "G". Spelled exactly: B-e-r-i-G-a-m-e.
```
Check the spelling on every candidate; regenerate rather than edit if a letter is wrong.

**Loading screen key art** (replaces the blue CSS gradient). `3072x1728` (16:9, 5.3 MP), opaque, sunburst `xhigh`. Keep the centre calm because the title, progress bar and tips sit on top of it.
```
STYLE: Painted key art for a cheerful low-poly tropical island brawler.
Stylised faceted low-poly 3D look rendered as a clean illustration: flat-shaded
polygons, soft warm dusk light from the left, no photorealism, no text, no
logos, no watermark, no UI.

A wide establishing shot of a small round sand island (#FFF1A1) in a deep teal
ocean (#006994) at dusk. Six stylised pine-shaped trees with three tiers of
green foliage are scattered around the island; each tree is dotted with
berries of one colour (blue, red, green, or gold). In the lower left third,
two small low-poly islander characters face each other in fighting stances,
one with a fist drawn back, one raising a round wooden shield. The sky is a
smooth gradient from slate blue (#7F9BBB) at the top to warm peach (#EBCDB0)
at the horizon with a few long flat low-poly clouds. The middle third of the
image is kept open and uncluttered (calm sky and water) so that a title and a
progress bar can be overlaid there. Slight vignette at the corners.
```

**Social / Open Graph card**: edit the key art, `1536x1024` (crop to 1200x630 afterwards), with `Recompose for a 1.9:1 social preview card: move the two fighters to the right third, leave the left half calm for a logo overlay.`

## 10. Sky background

`public/sky.jpg` is a CSS `background-image` on `body`, not a 3D skybox, so it needs a normal 16:9 frame rather than an equirectangular panorama. `3840x2160` (exactly the 8,294,400 px maximum), opaque, `output_format: "jpeg"`, `output_compression: 85`, sunburst `xhigh`.
```
STYLE: Stylised painted sky for a low-poly game background. Smooth, clean,
slightly faceted shapes, no photorealism, no noise or film grain, no sun disc,
no birds, no land, no water, no text.

A dusk sky filling the whole frame. Vertical gradient from muted slate blue
(#7F9BBB) at the top, through pale periwinkle (#A9BBD6) in the middle, to warm
peach (#EBCDB0) and a thin band of dusty rose (#C9A08F) along the very bottom
edge. Long, flat, horizontally stretched low-poly clouds with faceted
undersides, sparse in the top half and gathering in the lowest quarter, lit
peach-pink from below. The left and right edges should match closely in colour
and cloud density so the image can tile horizontally without an obvious seam.
The brightest part of the horizon glow is in the centre.
```
If a real skybox is wanted later, generate at `3840x1920` and ask for "equirectangular 360 degree panorama, horizon on the vertical centre line", then expect to fix the seam and poles by hand.

## 11. Suggested order of work

1. Pick fonts (not an image task; it changes how every frame reads).
2. Prompt 0, the style anchor. Iterate on flare `low` until the look is right, then one sunburst `high` run. Everything else depends on it.
3. Stance icons, then berry icons: highest gameplay value, smallest code change (`STANCE_ICON` map, `items.ts` icon paths).
4. Panel kit + buttons + HUD health bar: needs the CSS `border-image` work in `App.css`.
5. Action/status icons and FX sprites.
6. Logo, wordmark, loading key art, sky.

Rough count: about 45 final images. At 4 candidates each that is about 180 generations, plus drafts.

## Sources

- Image generation guide (models, sizes, quality, background, edits): https://developers.openai.com/api/docs/guides/image-generation
- GPT Image 2 model page: https://developers.openai.com/api/docs/models/gpt-image-2
- Simon Willison on ChatGPT Images 2.5 and the two API model IDs: https://simonwillison.net/2026/Sep/8/introducing-chatgpt-images-25/
