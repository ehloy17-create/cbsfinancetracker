# Architecture Notes

These notes must be verified by the AI assistant on each fresh session.

## Scan Requirements
Before making any edits, identify and summarize:

- main project structure
- frontend framework and entry point
- backend entry point
- database configuration location
- updater script and installer-related files
- Electron or desktop shell entry file if applicable
- files responsible for dashboard thumbnails
- files responsible for finance widgets
- files responsible for layout order

## Critical Risk Area
Any code that points to `http://localhost:4010` in an installed or packaged app is a critical review area.

The AI must determine:
- whether localhost loading is expected only in development
- whether production should instead load local built files
- whether the installed app is using development configuration incorrectly

## Change Strategy
All changes should be:
- targeted
- minimal
- reversible
- checkpointed in git
