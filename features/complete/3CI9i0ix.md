Feature ID: 3CI9i0ix

There is an icon used for the logo image now 🤖.  Any place we are using this, use the actual logo instead.  There are many size icons you can choose in the KaiBot project folder ./images/.  Use image tools like sips or even python code to find the right size image files and make them the logo.   Make a favicon file as well and make sure the web server uses it.

## Plan

- [x] 1. Resize KaiBotIcon512.png to 64px for web logo and copy to web/static/images/ — created web/static/images/KaiBotLogo64.png using Python/Pillow
- [x] 2. Create a 32px favicon.ico from KaiBotIcon512.png in web/static/ — created web/static/favicon.ico (16px + 32px) using Python/Pillow
- [x] 3. Add favicon route in routes.ts to serve /favicon.ico — added route before /static/* that delegates to serveStatic("/static/favicon.ico")
- [x] 4. Replace 🤖 emoji logo in templates.ts (project selection page) with an `<img>` tag — updated .logo div and added .logo img CSS
- [x] 5. Replace 🤖 emoji logo in templates.ts (main dashboard page) with an `<img>` tag — updated header status bar span.logo with inline img (28px)
- [x] 6. Add `<link rel="icon">` favicon tags to both HTML pages in templates.ts — added to project selection page and main dashboard page

## Summary

Replaced the 🤖 emoji placeholder logo with the actual KaiBot logo image throughout the web UI:

- **`web/static/images/KaiBotLogo64.png`** — 64×64px version of `KaiBotIcon512.png`, resized with Python/Pillow for use in page headers
- **`web/static/favicon.ico`** — multi-size favicon (16×16 and 32×32) created from `KaiBotIcon512.png`
- **`src/web/routes.ts`** — added `/favicon.ico` route that serves `web/static/favicon.ico`
- **`src/web/templates.ts`** — replaced `&#x1F916;` emoji with `<img>` tags on both the project selection page (48px) and the main dashboard header (28px inline); added `<link rel="icon">` to both page `<head>` sections
## Metadata

- **Model:** claude-sonnet-4-6
- **Cost:** $0.5777
- **Turns:** 37
- **Time:** 162.9s
