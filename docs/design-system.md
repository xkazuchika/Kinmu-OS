# Kinmu-OS UI foundations

Kinmu-OS v0.1 uses a quiet, trustworthy business interface: true-white work areas, a cool mist-blue navigation surface, deep navy text, and one royal-blue action color. The desktop and mobile concepts in this folder are the visual source of truth.

## Typography

- Japanese-first sans stack: Inter, Hiragino Sans, Yu Gothic UI, Yu Gothic, Meiryo, sans-serif.
- Page titles use `--font-size-2xl`, 700 weight, and the tight line height.
- Section titles use `--font-size-lg`; body and controls use 16px and 14px respectively.
- Labels remain visible. Placeholder text never substitutes for a label.

## Spacing and containers

- Spacing follows a 4px-root scale exposed as `--space-1` through `--space-8`.
- Workflows use open canvas, tables, and rails. Cards are reserved for a single meaningful boundary such as the current attendance action.
- Controls use 10px radii; large nested rounded containers and card grids are avoided.

## Color and state policy

- Body text uses `--color-text` on true white. Secondary text uses `--color-text-muted`.
- Primary actions use `--color-accent`; selected navigation uses `--color-accent-soft` plus text or an icon.
- Success, warning, and danger use their semantic token together with a written status. Color is never the only signal.
- Borders use `--color-border`; stronger input boundaries use `--color-border-strong`.

## Contrast and focus

- Normal text and interactive labels target WCAG AA contrast (4.5:1); large text targets at least 3:1.
- Keyboard focus uses a visible three-pixel blue ring with an offset, including links, inputs, selects, and buttons.
- Disabled state keeps the label readable and is reinforced by text and disabled semantics.
