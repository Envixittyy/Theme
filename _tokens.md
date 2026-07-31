# Hydra theme system — token reference & build notes

Working notes for the eight `theme.css` files in this folder. Not shipped to the
launcher; the launcher only ever loads one flat `theme.css`.

Built and verified against **Hydra Launcher v4.0.6** (tag `v4.0.6` of
`hydralauncher/hydra`).

---

## 1. Build approach

The launcher loads exactly one CSS file with no imports and no build step of its
own, so every variant has to be genuinely self-contained. Hand-editing eight
files would guarantee drift, so they are generated:

```
build/
  palettes.json          8 palettes + 2 language token sets  ← edit this
  templates/
    modern-glass.css     ~4.5k lines of selectors, all var()-driven
    paper-editorial.css  ~4.4k lines, same token names
  build.py               resolves tokens → writes the 8 theme.css files
  contrast_check.py      WCAG audit of the palette pairs
  fix_contrast.py        solves failing pairs by nudging lightness
  gen_surface_remap.py   regenerates sections 25–26 from Hydra's compiled CSS
```

```bash
python3 build/build.py           # write all eight files
python3 build/build.py --check   # validate, write nothing
python3 build/contrast_check.py  # WCAG audit
```

The only thing that differs between the four variants of a language is the token
block at the top of the file. The ~650 rules below it are byte-for-byte
identical across the four. `build.py` fails the build if a `var()` references an
undefined token, if braces don't balance, or if `@import` isn't the first rule.

**Adding a 9th palette:** add one entry to `build/palettes.json` with a
`language`, `label`, `scheme`, and the ~48 colour tokens, then run `build.py`.
No template edits. Run `contrast_check.py` after, and `fix_contrast.py` if it
reports failures.

---

## 2. What I confirmed about Hydra v4.0.6

Read from the actual source, not inferred. Several of these directly changed the
CSS, and two of them are almost certainly why earlier rounds broke.

**The achievement toast renders in a shadow root.**
`pages/achievements/notification/achievement-notification.tsx` mounts through
`react-shadow` and calls `injectCustomCss(code, shadowRootRef)`, appending the
theme `<style>` into a `<section>` *inside* the shadow tree. `:root` does not
match inside a shadow tree, so a token block declared only on `:root` leaves
every `var()` in the notification rules unresolved and the toast silently falls
back to stock styling. The token block is therefore emitted on:

```css
:root,
:host,
.achievement-notification { … }
```

`:host` matches the shadow host from inside the tree and custom properties
inherit down from it; it is valid syntax outside a shadow tree too (it simply
matches nothing), so the same rule is safe in the main window. Verified by
reading `--accent` off the chip inside a real `attachShadow` tree — it resolves.

**Hydra has no native CSS custom properties to override.** `scss/globals.scss`
uses SCSS variables (`$background-color: #121212`), which compile away. There is
no `--primary` to redefine; every value has to be overridden rule by rule. (The
`--primary` / `--outline` variables you see in ~250 community themes are those
authors' own, not Hydra's.)

**Injection point:** `helpers.ts → injectCustomCss` appends a
`<style id="custom-css">` last in `<head>`. Equal-specificity rules therefore
win on order, so repeating a selector verbatim beats stock without `!important`.
This is what sections 25–26 rely on.

**Remote fonts work.** 114 of the 402 community `theme.css` files use
`@import url('https://fonts.googleapis.com/…')`. Only 2 use `@font-face`, both
with relative paths that don't resolve. So: `@import` Google Fonts, keep a full
system-font fallback stack for offline use.

**Do not touch `animation` or `width` on `.achievement-notification__outer-container`.**
Hydra drives the toast's reveal (`content-in` → `content-wait` → `content-expand`,
80px → 320px) through that one property. Overriding it breaks the expand. The
templates set visual properties there only.

**`.game-card__cover` and `.hero__media` are `z-index: -1`**, i.e. they paint
*behind* their own card's background. Giving `.game-card` a translucent glass
background veils the artwork. Found this in a screenshot — the covers rendered
visibly muted. `.game-card` is now transparent; its glass reads from the border
and the backdrop gradient.

**Selector corrections vs. the brief's Appendix A:**

| Item | Finding |
| --- | --- |
| `.settings-download-sources__item` | **Does exist** in 4.0.6 (`settings-download-sources.scss`). It was just collapsed during the DevTools capture. Styled. |
| `.download-group__item` | Stale — 4.0.6 uses `.download-group__simple-*`, as Appendix A says. Both are styled, `__simple-*` as primary. There is also a `--hero` download layout with a speed chart and stat blocks that Appendix A doesn't list. |
| Achievement toast markup | Recovered from source; no manual capture needed. Full class list in §6. |
| Context menus, in-app toasts, empty states | All found in source (`context-menu.scss`, `toast.scss`, `.downloads__no-downloads`, `.game-details__reviews-empty`, `.friends-box__box--empty`). Styled. No capture needed. |
| `.game-details__hero-image--blurred` | Exists in stock CSS but **nothing applies it** in 4.0.6 — dead code. The live blur is `.game-details__wrapper--blurred`, used for NSFW blocking, which the themes deliberately leave alone. |
| `.game-details__hero-image-wrapper` | Not in Appendix A; it's the element that actually clips the banner. Styled. |
| `.title-bar__window-controls` / `__window-control--close` | Not in Appendix A. Styled. |

**Hydra hardcodes dark hex values on ~120 classes** (`#0d0d0d`, `#121212`,
`#1c1c1c`) and near-white text on ~100 selectors, mostly `:hover` states, at a
specificity a single-class rule can't beat. Left alone these are invisible in a
dark theme but leave black islands and vanishing hover labels across every light
variant. Sections 25–26 of each template remap them and are regenerated by
`gen_surface_remap.py` from the compiled stock CSS — rerun it when Hydra adds
screens.

---

## 3. Token set

95 tokens, identical names in all eight files. Only values change.

**Shape** (per language) — `--radius-xs/sm/md/lg/xl/2xl/pill`
Glass: 8/12/16/20/24/28/999px. Paper: 0/0/2/2/3/3/2px. This is the primary
visual contrast between the two languages.

**Spacing** (per language) — `--space-1` … `--space-8`
Glass: 6/10/14/18/24/32/40/56px. Paper: 6/10/16/22/28/38/48/64px.
For reference, stock Hydra nav items are `padding: 9px 8px`; these are
`14px 18px` and `16px 16px 16px 22px` respectively.

**Type** — `--font-body`, `--font-display`, `--font-mono`, `--fs-xs`…`--fs-3xl`,
`--fw-body/medium/bold/display`, `--tracking-tight/normal/wide/caps`,
`--lh-tight/body`

**Motion** — `--dur-fast` (150ms), `--dur-base` (200–220ms), `--dur-slow`
(300–320ms), `--dur-ambient` (52–60s), `--dur-ambient-2` (68–80s),
`--ease-out`, `--ease-in-out`, `--ease-spring`, `--lift`, `--lift-strong`

**Surfaces** — `--surface-0` (app base) … `--surface-4` (highest elevation),
`--glass-bg`, `--glass-bg-2`, `--glass-bg-strong`, `--glass-blur`,
`--glass-blur-strong`, `--glass-saturate`, `--texture-opacity`

**Lines** — `--border`, `--border-strong`, `--border-hairline`

**Text** — `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse`

**Accent** — `--accent`, `--accent-hover`, `--accent-press`, `--accent-contrast`
(text *on* the accent), `--accent-soft` / `--accent-softer` (translucent tints),
`--accent-glow`, `--accent-2`, `--accent-2-soft`

**Semantic** — `--success`, `--warning`, `--danger`, `--danger-soft`

**Depth & misc** — `--shadow-sm/md/lg`, `--shadow-glow`, `--overlay` (modal
backdrop), `--scrim-1` / `--scrim-2` (the gradient that keeps text legible over
artwork), `--selection-bg/fg`, `--scrollbar-track/thumb/thumb-hover`,
`--skeleton-base/shine`, `--ambient-1/2/3`, `--ambient-opacity`

Some tokens are deliberately unused by one language — Paper defines
`--glass-blur: 0px` and `--shadow-glow` because the names must line up for
mechanical palette swaps. `build.py` has an allowlist for these and still errors
on any genuinely orphaned token.

---

## 4. Palettes

### Cool — "Cove"

Blue-violet with a teal second accent, not grey-with-a-blue-button. Dark mode
is anchored on a deep navy (`#0B1220`) rather than neutral black, so the whole
UI reads cool even where there's no accent on screen.

| | surface-0 | surface-1 | surface-2 | surface-3 | surface-4 | accent | accent-2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| glass dark | `#0B1220` | `#131C2E` | `#1B2740` | `#243352` | `#2E4066` | `#6594FF` | `#38E0C8` |
| glass light | `#EBF1FB` | `#FFFFFF` | `#F5F9FE` | `#E2EBF9` | `#D2DFF4` | `#0044F7` | `#0B675D` |
| paper dark | `#0F141C` | `#171E29` | `#1F2836` | `#2A3444` | `#374355` | `#6E9BFF` | `#4FC4B8` |
| paper light | `#F3F6FB` | `#FFFFFF` | `#FAFBFE` | `#E8EEF7` | `#D8E2F0` | `#2B57D6` | `#0C6E6C` |

### Second palette — "Ember"

The folder slug is `warm`, so I kept the family warm, but the point of view is
in the pairing rather than the hue.

**The reasoning you asked for:** an all-warm palette goes muddy in dark mode —
warm mid-tones sit close together in luminance, so elevation levels stop being
distinguishable and the whole thing turns into brown soup. That's the failure
mode behind "too dark / doesn't pop." So Ember is built on **clay-tinted
neutrals rather than brown**, with a saturated amber-coral primary and a
deliberately **cool teal-sage secondary** (`#5FCFAE` dark / `#256B57` light).

The cool secondary is doing real work, not decoration:

- it keeps a cold reference point on screen, so the warm surfaces read as warm
  by comparison instead of as "dim";
- it gives the accent something to sing against — amber next to sage is a much
  louder interval than amber next to more amber;
- it supplies a distinct positive/success hue that isn't just green-by-default.

So it's warm as the slot requires, but it isn't the cool palette with the hue
wheel spun 180°, and it isn't a monochrome wash.

| | surface-0 | surface-1 | surface-2 | surface-3 | surface-4 | accent | accent-2 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| glass dark | `#171110` | `#241A16` | `#30231D` | `#3F2E26` | `#513C31` | `#FF8A4C` | `#5FCFAE` |
| glass light | `#FAF2EA` | `#FFFFFF` | `#FFF8F2` | `#F3E4D7` | `#E7D3C2` | `#9D4612` | `#256B57` |
| paper dark | `#16110F` | `#1F1815` | `#2A211C` | `#382C24` | `#493931` | `#E9743F` | `#7FB79A` |
| paper light | `#F9F3EC` | `#FFFDFA` | `#FFFFFF` | `#F0E5D9` | `#E2D2C1` | `#A44517` | `#346E53` |

### Dark mode is its own variant

Not inverted light mode. Five deliberately separated elevation steps
(`surface-0` → `surface-4`), each ~6–10 points of luminance apart so panels,
cards and menus are distinguishable without borders doing all the work. Accents
are *brighter* in dark mode than light (`#6594FF` vs `#0044F7`) rather than the
same hue reused — a light-mode accent on a dark surface reads dull.

---

## 5. Design decisions worth knowing

**Ambient background.** Two independent layers of soft radial colour fields,
animated on `background-position` only — no `scale`, no `transform` zoom, ever.
The two layers run at deliberately different periods (52s / 68s in glass, 60s /
80s in paper) so they never resynchronise and the composite never visibly loops.
Amplitude is a few percent. Paper adds an SVG `feTurbulence` grain sheet that
creeps in 12 discrete steps over 80s. All of it is disabled under
`prefers-reduced-motion: reduce`, along with every hover transform.

**Motion budget.** 150–320ms for anything interactive; the long durations are
reserved for the ambient layers, exactly as briefed.

**The banner stays crisp.** `.game-details__hero-image` gets
`filter/backdrop-filter/transform/opacity` reset with `!important`, which also
neutralises the stock `--blurred` modifier if it's ever wired up. NSFW blocking
(`.game-details__wrapper--blurred`) is untouched.

**Artwork scrims.** `--scrim-1/-2` fade from ~90–94% opaque at the very bottom
to fully transparent by 50% of the element's height, so titles stay readable but
the top half of every cover is completely unveiled. Dark and light modes use
different alphas — an opaque light scrim wipes out too much of the image.

**Achievement toast.** Glass: 20px radius, glass container with an accent wash,
and the points chip gets a filled accent-gradient pill with a glow, a 4px
accent ring and an inner highlight — the "bare points area" from earlier rounds
is now a deliberately designed element. Paper: a rotated printed stamp with a
hard 2px offset shadow, a perforation rule down the inner edge, mono tabular
figures, and a left accent rule on the card. Rare and platinum variants keep
their gold/cyan identity in both languages, written at two-class specificity to
match Hydra's own variant rules.

**Achievement sound.** None supplied. The design doesn't call for one — if you
want it, drop `achievement.mp3|ogg|wav|m4a` next to `theme.css`. For Paper a
short mechanical stamp/typewriter thunk would fit; for Glass a soft rising chime.

---

## 6. Achievement toast class list

Recovered from `components/achievements/notification/achievement-notification.{tsx,scss}`,
so the gap in the brief is closed without a manual capture.

```
.achievement-notification
.achievement-notification--top-left|--top-center|--top-right
                          |--bottom-left|--bottom-center|--bottom-right
.achievement-notification--rare|--platinum|--hidden|--closing|--paused
.achievement-notification__outer-container      ← do not set animation/width
.achievement-notification__container
.achievement-notification__content
.achievement-notification__icon
.achievement-notification__additional-overlay
.achievement-notification__dark-overlay
.achievement-notification__trophy-overlay
.achievement-notification__ellipses-overlay
.achievement-notification__text-container
.achievement-notification__title
.achievement-notification__hidden-icon
.achievement-notification__description
.achievement-notification__chip                 ← the points area
.achievement-notification__chip__icon
.achievement-notification__chip__label
```

The chip is a **sibling** of `__outer-container`, not a child, so it isn't
clipped by that element's `overflow: clip` — which is why the Paper stamp can
rotate outside the card.

---

## 7. How this was verified

Not "should work from reading the CSS" — that was the explicit complaint last
round.

1. **Cloned `hydralauncher/hydra` at v4.0.6** and compiled all 147 renderer SCSS
   files with dart-sass (0 failures) to get the real stock cascade.
2. **Built a DOM harness** reproducing the actual component markup from the
   `.tsx` sources, with Hydra's compiled CSS as the base layer and the theme
   injected the same way the app injects it. The achievement toast is mounted in
   a real `attachShadow` tree with the theme injected into an inner `<section>`,
   byte-for-byte matching `injectCustomCss(code, shadowRootRef)`.
3. **Rendered 40 screenshots** in Chromium (8 variants × home, game details,
   downloads, settings, overlays) at 1500×950 with the sidebar at Hydra's real
   default width (250px, from `SIDEBAR_INITIAL_WIDTH`).
4. **Probed computed styles** rather than source text — confirming per variant
   that the banner has `filter: none`, that radius/padding/blur resolve to the
   intended values, that the display font applies, that the stylesheet parses
   with no console errors, and that `--accent` resolves *inside the shadow root*.
5. **Audited contrast** two ways: a DOM sweep of every rendered text node, and a
   deterministic checker over the palette tokens. The two agreed to 2 decimal
   places on solid backgrounds, which validated both.

Things this caught that reading the CSS would not have:

- the achievement toast losing every token to the shadow-DOM boundary;
- `.game-card`'s glass background veiling cover art painted at `z-index: -1`;
- ~87 hardcoded dark surfaces and ~100 hardcoded light-text hover rules that
  made the light variants unusable;
- the specifics row on game cards half-peeking at rest because Hydra's
  `translateY(24px)` assumes stock padding;
- 29 failing colour pairs in the light palettes, plus a second round of 12 that
  only appear when accent text sits on its own `--accent-soft` tint.

**Current state:** `contrast_check.py` reports all audited pairs passing.
The DOM sweep is clean for both Paper light variants and reports only known
false positives elsewhere (text over gradient-filled buttons and translucent
modals, which it can't composite).

**Not verified:** these were rendered in Chromium against Hydra's compiled CSS,
not inside the running Electron app. Worth a look at the real thing —
particularly the ambient layer behind live `backdrop-filter`, which depends on
GPU compositing that a screenshot harness approximates rather than reproduces.

---

## 8. If you publish one

Per the docs, the community repo wants:

- folder named `Theme Name-<friend code>` (the current folders are unsuffixed —
  local use only)
- `theme.css`
- `screenshot.(png|webp|jpg|jpeg|avif|heic|heif)`
- optionally `achievement.(mp3|ogg|wav|m4a)`
