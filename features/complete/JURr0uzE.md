Feature ID: JURr0uzE

The new feature dialog has 2 buttons.  Currently Hold and Save.   Change hold to "Save to Backlog" and "Save".  Add a new button called "Submit to Assistant".

Pressing the Submit to Assistant should submit the text in the Title and Description to the server.  The server should use the prompt from the prompts/feature_assist.md file.  That file contains replacement markers {featureName} and {details}.   Replace those in the prompt with the title (featureName) and description text (details).   Use the coding agent with that prompt and return the result back to the TITLE and DESCRIPTION based on the output from the prompt.

## Plan

- [x] 1. Update dialog HTML: rename "Hold" to "Save to Backlog", add "Submit to Assistant" button — updated templates.ts dialog footer
- [x] 2. Add server endpoint `POST /api/features/assist` that reads `feature_assist.md`, replaces `{featureName}` and `{details}`, runs via KaiClient, and returns parsed title/description — added route + parseFeatureAssistResponse in routes.ts
- [x] 3. Add client-side `submitToAssistant()` function that calls the new endpoint and updates the title/description fields — added in client.js
- [x] 4. Wire up the new button click handler in the event delegation section — added click handler for nf-assist in client.js
- [x] 5. Test the build compiles and lint passes — typecheck clean, lint clean (only pre-existing warnings)

## Summary

Implemented the "Submit to Assistant" feature for the New Feature dialog:

1. **Dialog buttons updated** (`src/web/templates.ts`): Renamed "Hold" to "Save to Backlog" and added a new "Submit to Assistant" button between the two existing buttons.

2. **New API endpoint** (`src/web/routes.ts`): Added `POST /api/features/assist` that loads `prompts/feature_assist.md`, replaces `{featureName}` and `{details}` placeholders with the submitted title and description, runs the prompt through the Claude agent via `KaiClient.run()`, parses the response (extracting `FEATURE TITLE:`, `DESCRIPTION:`, and optional `CLARIFY` sections), and returns the result as JSON.

3. **Client-side handler** (`web/static/html/client.js`): Added `submitToAssistant()` function that sends title/description to the new endpoint, updates the dialog's title input and description editor with the AI-refined response, and shows any clarification questions. All three buttons are properly disabled during any submission to prevent double-clicks.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.2301
- **Turns:** 39
- **Time:** 244.9s
