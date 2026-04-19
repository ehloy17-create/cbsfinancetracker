# AI Context - Read First

This folder is the source of truth for any AI assistant working on this project, including GitHub Copilot, Claude, or other coding agents.

## Mandatory rule for AI
Before making any code changes, always do the following:

1. Read all files inside `/ai-context`
2. Scan the project structure
3. Identify:
   - frontend
   - backend
   - database connection
   - build scripts
   - packaging / installer / updater files
   - dashboard UI files
   - finance widget files
4. Summarize the current project state before editing
5. Create or verify a git checkpoint before making changes
6. Make only minimal, safe, targeted edits
7. After edits, verify the build still works

## Never do these without review
- Do not rewrite unrelated modules
- Do not refactor large working sections unless absolutely required
- Do not change build scripts, updater flow, or database config unless the task explicitly requires it
- Do not remove existing working logic without documenting why

## Restore rule
If changes fail or break the build, restore the project using git to the latest known working checkpoint.

This folder must be reviewed every time the project is opened before any code changes are made.
