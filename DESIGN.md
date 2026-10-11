---
name: HomeNet
description: Self-hosted network watchdog for Umbrel; a calm night console for a home network.
colors:
  wallpaper-deep: "oklch(0.155 0.022 265)"
  window-sheet: "oklch(0.2 0.016 265 / 0.8)"
  window-solid: "oklch(0.205 0.016 265)"
  canvas: "oklch(0.205 0.014 265)"
  canvas-raised: "oklch(0.235 0.015 265)"
  tile: "oklch(0.97 0.006 265 / 0.045)"
  tile-raised: "oklch(0.97 0.006 265 / 0.075)"
  surface: "oklch(0.97 0.006 265 / 0.055)"
  surface-2: "oklch(0.97 0.006 265 / 0.085)"
  surface-3: "oklch(0.97 0.006 265 / 0.13)"
  hairline: "oklch(0.97 0.006 265 / 0.06)"
  border: "oklch(0.97 0.006 265 / 0.09)"
  border-strong: "oklch(0.97 0.006 265 / 0.17)"
  text: "oklch(0.97 0.004 265)"
  text-muted: "oklch(0.97 0.004 265 / 0.66)"
  text-faint: "oklch(0.97 0.004 265 / 0.46)"
  chalk: "oklch(0.95 0.008 265)"
  ink: "oklch(0.21 0.02 265)"
  dusk-violet: "oklch(0.7 0.16 268)"
  dusk-violet-deep: "oklch(0.64 0.2 270)"
  gradient-start: "oklch(0.66 0.19 262)"
  gradient-end: "oklch(0.58 0.22 285)"
  status-ok: "oklch(0.78 0.16 160)"
  status-warn: "oklch(0.82 0.15 80)"
  status-err: "oklch(0.7 0.19 22)"
  status-info: "oklch(0.76 0.12 245)"
  data-download: "#3987e5"
  data-upload: "#d55181"
  series-2: "#d95926"
  series-3: "#199e70"
  series-4: "#c98500"
  series-6: "#008300"
  series-7: "#9085e9"
  series-8: "#e66767"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  numeral:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.045em"
    fontFeature: "'tnum', 'cv11'"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'cv11', 'ss01'"
  meta:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  sm: "8px"
  control: "12px"
  inset: "14px"
  panel: "22px"
  window: "28px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.dusk-violet-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-small:
    rounded: "{rounded.pill}"
    padding: "0 11px"
    height: "28px"
  nav-tab:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "0 13px"
    height: "32px"
  nav-tab-active:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  segment-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "26px"
  range-segment-active:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "30px"
  input:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  tile:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
  tile-attention:
    backgroundColor: "{colors.tile-raised}"
    rounded: "{rounded.panel}"
    padding: "18px 20px"
  status-pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "4px 11px"
  open-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    size: "32px"
---

# Design System: HomeNet

## 1. Overview

**Creative North Star: "The Night Console"**

HomeNet is an instrument panel read in a dim room. The admin glances at it from the couch or in bed, lights low, and in two seconds knows whether the network is fine. Everything serves that glance: the page title is the state of the internet itself ("Internet online"), alerts sit beside the first chart, and colour stays quiet until something is wrong. When something is wrong, it is the only coloured thing on screen.

The shell borrows umbrelOS's spatial language. The app is one rounded sheet floating over a soft, blurred wallpaper of violet, cyan, magenta and teal glows; navigation and floating layers are frosted glass; content tiles inside the sheet are flat, translucent and hairline-bordered. Depth comes from layering (wallpaper → sheet → tile → control), not from heavy shadows. The signature move is light numerals: large, weight-300 figures for live rates and counts, set beside small muted labels, so numbers read before words.

The system rejects **dense enterprise dashboards**, **neon "hacker" security tools**, and **identical icon-card grids** (PRODUCT.md). It is not a SIEM, not a gamer overlay, and not a SaaS KPI template. It is information-dense where the admin digs in (tables, device detail) and generous where the admin glances (overview header, status).

**Key Characteristics:**
- Dark-first, tinted toward hue 265; never pure black or white.
- Glass shell, flat content: blur only on the nav, the app bar strip, popovers, save bar, toasts.
- One accent (Dusk Violet); every other colour means state or identifies data.
- Pills for every control; 22px tiles; a 28px floating window on desktop.
- Light numerals (weight 300) for headline figures; tabular numbers everywhere data appears.
- Bento layout on the overview, predictable grids everywhere else.
- Three navigation forms from one markup: top pill bar (desktop), floating vertical rail (tablet), floating bottom dock (phone).

## 2. Colors

A restrained night palette: tinted near-black neutrals expressed as translucent whites, one blue-violet accent, and a strict state vocabulary.

### Primary
- **Dusk Violet** (oklch(0.7 0.16 268)): the only accent. Focus rings, the current latency column and its value bubble, the data-quota arc when within plan, selection highlights. Never decoration.
- **Deep Dusk Violet** (oklch(0.64 0.2 270)): solid fill for the "on" switch and the primary button's base.
- **Dusk Gradient** (oklch(0.66 0.19 262) → oklch(0.58 0.22 285), 135deg): primary call-to-action fill only (Salva, confirm). One per view, at most.

### Secondary
- **Chalk** (oklch(0.95 0.008 265)) with **Ink** text (oklch(0.21 0.02 265)): the luminous "you are here" fill. Active nav tab, active time-range segment, the largest traffic-share segment, the hovered open button. It is the umbrelOS highlight: light pill on dark glass.

### Tertiary (state)
- **Signal Green** (oklch(0.78 0.16 160)): online, OK, resolved. Also the "online" word in the overview title.
- **Lamp Amber** (oklch(0.82 0.15 80)): warning. Watchlist traffic, WAN ready-but-not-default, slow latency (≥150 ms), plan projected over quota.
- **Ember Red** (oklch(0.7 0.19 22)): error. Offline, WAN down, very slow latency (≥400 ms), destructive buttons.
- **Info Blue** (oklch(0.76 0.12 245)): informational events and setup banners.

Data series colours (download #3987e5, upload #d55181, series #d95926 / #199e70 / #c98500 / #008300 / #9085e9 / #e66767) identify entities in charts and are assigned by device id, never by rank.

### Neutral
- **Wallpaper Deep** (oklch(0.155 0.022 265)): the backdrop under the radial glows; visible only in the window margin and through the sheet.
- **Window Sheet** (oklch(0.2 0.016 265 / 0.8)): the app window. Translucent, not blurred: the wallpaper is already soft.
- **Tile** (white at 4.5%) / **Tile Raised** (7.5%): content tiles; raised only for "Da controllare".
- **Surface 1-3** (white at 5.5% / 8.5% / 13%): control fills, hover, selected segment.
- **Hairline / Border / Strong Border** (white at 6% / 9% / 17%): tile edges and row dividers; control edges; hover edges and the brand badge.
- **Text / Muted / Faint** (oklch(0.97 0.004 265) at 100% / 66% / 46%): primary copy; secondary copy and labels; metadata, axis ticks, captions.

### Named Rules
**The One Voice Rule.** Dusk Violet is the only accent and covers ≤10% of any screen. If two things on screen are violet and neither is focused or current, one is wrong.

**The State-Only Colour Rule.** Green, amber and red appear only when they mean online/warning/error, and always next to a word or icon. A neutral latency bar stays chalk-grey until it is actually slow.

**The Chalk Rule.** The light pill marks "current" (tab, range, biggest share). Never use it for a merely important button.

## 3. Typography

**Display Font:** Inter Variable (with Inter, system-ui, -apple-system, Segoe UI)
**Body Font:** Inter Variable
**Label/Mono Font:** Inter Variable with tabular figures; no separate mono.

**Character:** one neutral, highly legible sans carries everything. Hierarchy comes from the contrast between a very light large weight (300) for figures and a firm semibold (600) for titles, not from a second family.

### Hierarchy
- **Display** (500, 36px, 1.05, -0.04em): the overview status title only ("Internet online"). 30px on phones.
- **Numeral** (300, 32px, 1, -0.045em, tabular): live rates, counts and totals in stats strips; 38px for current latency, 28px inside the quota ring, 24-26px on phones. Units follow at 15px/500 in Muted.
- **Headline** (600, 26px, 1.12, -0.03em): page titles. 24px on phones.
- **Title** (600, 15px, 1.3, -0.015em): tile titles, paired with a 17px line icon in Faint.
- **Body** (400, 14px, 1.5): rows, descriptions, form copy. Prose capped at 64ch.
- **Meta** (400, 12.5px): tile subtitles, secondary row lines, timestamps.
- **Label** (600, 11px, 0.06em, UPPERCASE): table headers and record labels on phones only.

### Named Rules
**The Light Numeral Rule.** Headline figures are weight 300 and large; their labels are small and muted beneath. Never set a key metric in bold.

**The Tabular Rule.** Any number that can change or be compared uses tabular figures.

## 4. Elevation

Hybrid and restrained. Depth is mostly tonal: wallpaper, then the translucent sheet, then flat tiles lightened by a few percent of white, then controls. Shadows exist only on things that float above content, and blur exists only where content passes underneath.

### Shadow Vocabulary
- **Window** (`box-shadow: 0 40px 100px oklch(0.08 0.03 265 / 0.5), inset 0 1px 0 oklch(0.97 0.006 265 / 0.06)`): the desktop app sheet lifting off the wallpaper.
- **Float** (`box-shadow: 0 18px 50px oklch(0.08 0.02 265 / 0.55), 0 2px 8px oklch(0.08 0.02 265 / 0.3)`): popovers, modal, toast, save bar.
- **Nav** (`box-shadow: 0 8px 28px oklch(0.08 0.02 265 / 0.3)`): the pill nav, rail and dock, plus `backdrop-filter: blur(20px) saturate(1.3)`.
- **Tile highlight** (`box-shadow: inset 0 1px 0 oklch(0.97 0.006 265 / 0.04)`): a 1px top sheen on tiles; no drop shadow.
- **Primary glow** (`box-shadow: 0 6px 22px oklch(0.6 0.2 270 / 0.35)`): the primary button only.

### Named Rules
**The Glass Shell Rule.** Blur belongs to navigation, the scrolled app-bar strip, popovers, the save bar and toasts. Tiles never blur. If a tile needs a blur to look good, its contrast is wrong.

**The Stacked Sheet Rule.** Only the "Da controllare" tile shows the two stacked layers peeking above it. Its elevation is semantic: it is the pile of things to deal with.

## 5. Components

### Buttons
Soft pills, compact, high contrast.
- **Shape:** full pill (999px), 34px tall, 28px for small.
- **Primary:** Dusk Gradient fill, white-tinted 14% border, glow shadow, 550 weight 13.5px.
- **Secondary:** Surface fill, Border edge; hover to Surface 2 and Strong Border.
- **Danger:** Ember Red at 12% fill, 40% border, light red text. Always behind a confirmation.
- **Ghost / icon:** transparent until hover; icon-only buttons are square pills (34px / 28px) with a fixed 16px icon.
- **Active:** scale(0.975). **Focus:** 2px Dusk Violet ring at 60%, 2px offset.

### Chips
- **Status pill:** Surface 2 fill, hairline edge, 12px/550 Muted text, 13px icon. Tinted amber/red/green variants for state (12-13% fill, 20% border, lightened text).
- **Segments:** pill track on a dark 30% inset; the active segment is Surface 3. The time-range control is the large variant whose active segment is Chalk with Ink text. Labels are short (1h · 24h · 7g · 15g) with full names in `aria-label`.

### Cards / Containers
- **Corner Style:** 22px tiles (20px on phones); 14px insets; 28px window.
- **Background:** Tile (4.5% white). "Da controllare" uses Tile Raised.
- **Shadow Strategy:** top sheen only (see Elevation).
- **Border:** 1px Hairline.
- **Internal Padding:** 18px × 20px (18px on phones).
- **Header:** title with muted line icon, subtitle in Meta; controls right; a round 32px **open button** (↗) top-right when the tile has a detail page. Hover turns it Chalk.

### Inputs / Fields
- **Style:** 34px, 12px radius in forms, dark 25% inset fill, Border edge. Toolbar filters and search use the pill variant.
- **Focus:** border to Dusk Violet 60% plus a 3px Dusk Violet 16% halo.
- **Search:** 40px pill in the app bar with a ⌘K hint. On tablets and phones it collapses to a round button and opens as a full-width floating sheet with results beneath.

### Navigation
- **Desktop (≥1024px):** brand badge (outlined pill, 40px) left; a glass pill bar centered; search and a status chip right. Tabs are 32px pills: Muted text, Surface 2 on hover, Chalk with Ink when active. Below 1360px wide, inactive tabs collapse to icons.
- **Tablet (720-1023px):** the same bar becomes a floating vertical glass rail at the left edge, 44px icon targets.
- **Phone (<720px):** a floating bottom dock, centered, max 400px wide, safe-area aware; the window goes full-bleed.

### Stats Strip (signature)
A row of Light Numerals with a 20px round icon chip and a Muted label beneath. It opens Overview, Devices, Services, Monitor and device detail, sitting directly on the sheet with no card around it. Two columns on phones.

### Traffic Share Strip (signature)
Labelled pills sized by each device's share of traffic: the largest in Chalk, then 30% / 16% / 9% white, and the remainder as a hatched "Altri" pill. Device identity is a 7px dot in the label, not the fill. Two named devices on phones.

### Latency Columns and Quota Ring (signature)
Latency is a row of 6px rounded columns over dotted guides; the newest column is Dusk Violet with a value bubble. The data plan is a 270° ring with one tick per billing day (elapsed ticks bright) and an arc for usage, Dusk Violet within plan, amber/red when the projection exceeds it.

### Tables
Uppercase Label headers, 12px cell padding, Hairline row dividers, subtle hover. On phones, record tables (Devices, Services) become stacked records in a three-column grid with per-field labels; other tables scroll horizontally.

## 6. Do's and Don'ts

### Do:
- **Do** put state first: the overview title is the internet state, and "Da controllare" sits beside the first chart.
- **Do** keep Dusk Violet (oklch(0.7 0.16 268)) for focus, current and selection only, ≤10% of the screen.
- **Do** pair every status colour with a word or an icon; status is never colour-only.
- **Do** set headline figures as Light Numerals (300 weight) with tabular figures and a muted unit.
- **Do** use pills for every control and 22px tiles for content; keep tiles flat with a 1px Hairline.
- **Do** compose for each breakpoint (pill bar → rail → dock; bento four columns ≥2000px → twelve-column bento → two columns → priority stack), never just shrink.
- **Do** keep the UI at 1:1 scale on large monitors; use the extra width for more columns, never a global zoom.
- **Do** keep transitions at 150-250ms with cubic-bezier(0.25, 1, 0.5, 1), and honour reduced motion.
- **Do** confirm destructive actions and visually separate them with the Ember Red treatment.

### Don't:
- **Don't** build **dense enterprise dashboards**: no wall of equal-weight widgets, no 12-column KPI farms.
- **Don't** drift into **neon "hacker" security tools**: no green-on-black, no glowing outlines, no terminal cosplay.
- **Don't** ship **identical icon-card grids**: if three tiles have the same icon + number + label shape, turn them into a Stats Strip.
- **Don't** blur tiles or use glass as decoration (The Glass Shell Rule).
- **Don't** use `border-left`/`border-right` over 1px as a coloured stripe on cards, rows or alerts.
- **Don't** use gradient text, or any gradient other than the primary button and the wallpaper.
- **Don't** use #000 or #fff; tint every neutral toward hue 265.
- **Don't** colour a chart bar amber or red unless the value has actually crossed a threshold.
- **Don't** scale the whole interface up on wide screens (`zoom`, root font-size bumps); it reads as "zoomed in" and wastes the space.
- **Don't** reach for a modal when an inline control or floating bar will do; the save bar is the model.
