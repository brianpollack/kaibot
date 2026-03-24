Feature ID: d6QwVHjB

Apply the following colors and notes to the webui design

# 2. Color System

## Backgrounds

| Usage           | Hex     |
|-----------------|---------|
| Main Background | #0B0F1A |
| Card Background | #121826 |
| Hover Surface   | #1A2233 |
| Borders         | #2A344A |

## Accent Colors

| Purpose        | Hex     |
|----------------|---------|
| Primary (Blue) | #3B82F6 |
| Cyan Accent    | #22D3EE |
| Purple Accent  | #8B5CF6 |
| Success        | #22C55E |
| Warning        | #F59E0B |
| Error          | #EF4444 |

## Text Colors

| Usage     | Hex     |
|-----------|---------|
| Primary   | #FFFFFF |
| Secondary | #9CA3AF |
| Disabled  | #6B7280 |

## Plan

- [x] 1. Update base/background colors in main.css (#0d1117 → #0B0F1A, #161b22 → #121826, #21262d → #1A2233, #30363d → #2A344A) — replaced all 4 background/border colors
- [x] 2. Update primary blue accent (#58a6ff → #3B82F6, #1f6feb → #3B82F6) — all blue accents unified to #3B82F6
- [x] 3. Update success/green colors (#3fb950 → #22C55E, #238636 → #16A34A, #56d364 → #22C55E) — all green accents updated
- [x] 4. Update warning/yellow colors (#d29922 → #F59E0B) — warning color updated
- [x] 5. Update error/red colors (#f85149 → #EF4444) — error color updated
- [x] 6. Update purple accent colors (#d2a8ff → #8B5CF6) — purple accent updated
- [x] 7. Update cyan accent colors (#56d4dd → #22D3EE) — cyan accent updated
- [x] 8. Update text colors (#c9d1d9 → #FFFFFF, #8b949e → #9CA3AF, #484f58 → #6B7280) — all 3 text tiers updated
- [x] 9. Update derived/tinted background colors to match new palette — updated 8 tinted backgrounds (badge, stage, file-op type backgrounds)
- [x] 10. Verify CSS is valid by running typecheck/build — `npm run build` succeeds, no color refs in other web files

## Summary

Applied the new color system to `web/static/css/main.css`. All color values were updated:

- **Backgrounds**: Main (#0B0F1A), Card (#121826), Hover (#1A2233), Borders (#2A344A)
- **Accents**: Primary Blue (#3B82F6), Cyan (#22D3EE), Purple (#8B5CF6), Success (#22C55E), Warning (#F59E0B), Error (#EF4444)
- **Text**: Primary (#FFFFFF), Secondary (#9CA3AF), Disabled (#6B7280)
- **Derived tinted backgrounds**: All badge, stage, and file-op type backgrounds adjusted to harmonize with the new palette

## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $0.7612
- **Turns:** 41
- **Time:** 172.4s
