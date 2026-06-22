# Phase 7a Design System Report

Agent: Claude Sonnet 4.6 (phase-7a)  
Tasks completed: 7.1 – 7.5  
Commit range: `394c100..82a5ac8`

---

## Design Identity

**Shard = angular crystal fragment.** The aesthetic is sharp, geometric, mineral. Not soft, not gradient, not centered-card. Familiar Drive UX with an unmistakable identity.

---

## Color Palette

| Token | Hex | Use |
|---|---|---|
| `--color-bg` | `#0D0F12` | Page background (near-black) |
| `--color-surface` | `#141720` | Sidebar, cards, panels |
| `--color-surface-alt` | `#1A1F2E` | Hover state for surface items |
| `--color-border` | `#252A3A` | Default borders |
| `--color-border-focus` | `#4A90D9` | Active/focused borders |
| `--color-accent` | `#4A90D9` | **Shard blue** — primary interactive |
| `--color-accent-dim` | `#2E5F99` | Pressed accent |
| `--color-accent-glow` | `rgba(74,144,217,0.18)` | Subtle active fills |
| `--color-facet-dark` | `#1E2740` | Crystal shadow face |
| `--color-facet-mid` | `#2D4070` | Crystal mid face |
| `--color-facet-light` | `#4A90D9` | Crystal lit face (same as accent) |
| `--color-text` | `#E8EAF0` | Primary text |
| `--color-text-muted` | `#8B92A8` | Secondary / metadata |
| `--color-text-dim` | `#4A5070` | Placeholder / disabled |
| `--color-danger` | `#E05252` | Destructive actions |
| `--color-success` | `#4CAF7D` | Done states |
| `--color-warning` | `#E0A652` | Starred indicator |

**Rule:** Only `--color-accent` is the accent. Never add a second bright color. Violet/teal/green only appear in file-type indicators (FileIcons.tsx) which are intentionally per-type.

---

## Typography

| Role | Font | Usage |
|---|---|---|
| Display | **DM Serif Display** | Wordmark, page headings, dialog titles, login tagline |
| Body / UI | **Inter** | All body copy, buttons, labels, navigation |
| Mono | **JetBrains Mono** | File sizes, dates, paths, breadcrumbs in MoveDialog, user role badge |

Loaded from Google Fonts in `theme.css`. Do not substitute. The display/body contrast is intentional: DM Serif is editorial and slightly formal; it makes the utilitarian UI feel considered.

**Type scale** (all in `theme.css`):

```
--text-xs:    0.6875rem  (11px) — file sizes, timestamps
--text-sm:    0.8125rem  (13px) — secondary labels, button text
--text-base:  0.9375rem  (15px) — body
--text-md:    1.0625rem  (17px) — item names
--text-lg:    1.25rem    (20px) — section headings
--text-xl:    1.75rem    (28px) — page headings
--text-2xl:   2.75rem    (44px) — login "Sign in" heading
--text-3xl:   4rem       (64px) — login wordmark
```

---

## Geometry & Spacing

**Border-radius:** Maximum `--radius-lg: 6px`. Most elements use `--radius-sm: 2px` or none. Shard is angular — no pill buttons, no large rounded panels.

**Spacing scale** follows 4px increments (`--space-1` through `--space-16`).

**Borders:** 1px solid `--color-border` everywhere. No box-shadow on surfaces; a sharp border is the structural language.

---

## The Signature Element

`ShardMark` (`/frontend/src/components/ShardMark.tsx`) — a 48×48 SVG crystal facet with three interlocking polygon faces:

- Shadow face (bottom-left): `#1E2740`
- Mid face (right body): `#2D4070`  
- Lit face (top-right): `#4A90D9` (accent)
- Thin bright edge line: `#6AABF0`

This appears at 56px in the Login left panel and 24px in the Sidebar logo strip. It is the single most distinctive element; use it as-is, do not replace with a generic icon.

The Login page also uses a large decorative `clip-path` polygon background (`#1E2740 → #4A90D9` at 12% opacity) in the left panel — the second facet reference.

---

## Layout Patterns

### App Shell
- **Drive page:** flex row — fixed 220px sidebar + flex-1 main content area
- **Sidebar:** sticky, 100dvh, `--color-surface`, right border
- **Content:** `padding: var(--space-4) var(--space-6)` on the body

### Login page
- 2-column CSS grid (50/50), left = brand, right = auth
- Left panel: padding `var(--space-12)`, content at bottom (`justify-content: flex-end`)
- Collapses to single column below 720px

### Modals (PreviewModal, MoveDialog)
- Fixed overlay backdrop at `rgba(7,9,13,0.88)`
- Inner shell: `--color-surface` with 1px border, no border-radius
- Header bar with filename + download link + close button

### Context Menu
- Fixed positioning, viewport-clamped
- Min-width 180px, 1px border, 8px shadow
- Items 13px, 8px vertical padding

---

## Component Conventions

### Buttons
- Default: `border: 1px solid var(--color-border)`, transparent background, hover → `--color-surface-alt`
- Primary (toolbar new folder): accent border, accent text, hover → `--color-accent-glow` fill
- Confirm (MoveDialog): `background: --color-accent`, black text
- Destructive: text `--color-danger`, hover → `--color-danger-dim` background

### File items
- Grid: 140px min-width auto-fill, 1px border, hover border-color → `--color-border-focus`
- List: borderless table, row hover → `--color-surface-alt`, column headers in mono uppercase
- Starred indicator: `border-left: 2px solid --color-warning`

### Upload progress panel
- Fixed bottom-right, 320px wide
- 1px border, `--color-surface`, 2px progress bar
- Bar color: accent (uploading), success (done), danger (error)

### Empty states
- Centered text, `--color-text-muted`, simple prose: "This folder is empty."
- No illustrations, no decorative icons

---

## CSS Architecture

All CSS is component-scoped `.css` files imported directly in the component. No CSS modules, no CSS-in-JS. Variables live in `theme.css` (imported globally in `main.tsx`). Global utility classes (`.truncate`, `.font-mono`, `.text-muted`) are in `theme.css`.

**Do not** add `border-radius > 6px`. **Do not** add gradient backgrounds on surfaces. **Do not** add a second accent color. The design's restraint is part of its identity.

---

## File Map

```
frontend/src/
  styles/
    theme.css          ← all design tokens (source of truth)
    global.css         ← auth-loading animation
  components/
    ShardMark.tsx      ← crystal logomark (THE signature element)
    Sidebar.tsx / .css ← nav with logo, sections, user footer
    Breadcrumbs.tsx / .css
    Toolbar.tsx / .css
    FileGrid.tsx / .css
    FileRow.tsx / .css
    FileIcons.tsx      ← icon SVGs + formatSize/formatDate utils
    UploadZone.tsx / .css
    UploadProgress.tsx / .css
    ContextMenu.tsx / .css
    PreviewModal.tsx / .css
    MoveDialog.tsx / .css
  pages/
    Login.tsx / .css   ← two-panel branded sign-in
    Drive.tsx / .css   ← main file browser
    Setup.tsx / .css   ← placeholder (Phase 8 builds real wizard)
  api/
    client.ts          ← axios, withCredentials, /api base
    files.ts           ← all file CRUD functions
  context/
    AuthContext.tsx    ← AuthProvider, useAuth
  routes.tsx           ← ProtectedRoute, PublicOnlyRoute
  hooks/
    useUpload.ts       ← upload queue state machine
```

---

## For Phase 7b / 8 Agents

Match these exact values. The next tasks (7.6 Trash/Starred/Search, 7.7 sharing, 7.8 dashboard/settings, 8.2 setup wizard) should:

1. Import `theme.css` tokens — do not hardcode colors or font sizes
2. Use `ShardMark` for any logo placement
3. Use `DM Serif Display` for modal/dialog titles and page headings
4. Keep border-radius at or below 6px
5. New pages follow the Drive shell pattern (Sidebar + main content)
6. The setup wizard (Task 8.2) should use a **sidebar stepper** layout, not a centered card; apply the crystal facet background motif from the Login page's left panel
