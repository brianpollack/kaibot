Feature ID: GKplGGJP

Feature ID: bxP0sCZh

Add the conversation history points as JSON to the final log file that is created for each feature.   Add the File actvity information to that same json file.   Make sure there are time stamped elemented.

## Plan

- [x] 1. Add timestamp field to FileOp interface in ui/store.ts and populate it in pushFileOp — added `timestamp: number` to FileOp, auto-populated in pushFileOp
- [x] 2. Add snapshot methods to UIStore (getConversationSnapshot, getFileActivitySnapshot) that return serializable arrays with timestamps — added ConversationLogEntry/FileActivityLogEntry types and snapshot methods
- [x] 3. Add conversationHistory and fileActivity fields to the FeatureRecord type in featureDb.ts — added optional ConversationLogEntry[] and FileActivityLogEntry[] fields
- [x] 4. Collect conversation/file activity data in KaiBot.handleFeatureFile and pass to writeFeatureLog — snapshot captured before uiStore reset, included in record
- [x] 5. Also collect and pass data in KaiBot.handleLinearIssue for Linear mode — added snapshot capture before reset in Linear path too
- [x] 6. Add tests for the new snapshot methods and timestamp behavior — 9 tests in uiStoreSnapshots.test.ts, all passing
- [x] 7. Run typecheck and lint to verify everything compiles cleanly — typecheck clean, lint clean (errors), all 228 tests pass

## Summary

Added timestamped conversation history and file activity tracking to the feature log JSON files (`features/log/<featureId>.json`). The `FileOp` interface now includes a `timestamp` field that is auto-populated when file operations are recorded. Two new snapshot methods on `UIStore` (`getConversationSnapshot` and `getFileActivitySnapshot`) produce serializable arrays with ISO 8601 timestamps. The `FeatureRecord` type was extended with optional `conversationHistory` and `fileActivity` fields, and both the file-mode and Linear-mode processing paths in `KaiBot` now capture these snapshots before writing the log file. Nine new tests verify the snapshot methods and timestamp behavior.
## Metadata

- **Model:** claude-opus-4-6
- **Cost:** $1.3133
- **Turns:** 33
- **Time:** 268.5s
