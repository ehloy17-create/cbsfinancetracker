# Session Template

Use this at the start of every new AI session.

## Required startup behavior for AI
Before making any change:

1. Read all files in `/ai-context`
2. Scan the project structure
3. Summarize:
   - architecture
   - current status
   - pending tasks
   - risk areas
4. Identify exact files that will be edited
5. Verify git checkpoint status
6. Only then propose or apply changes

## Required end-of-session behavior for AI
Before ending work:

1. Summarize what was changed
2. Note what files were modified
3. Note whether build/test succeeded
4. Update `CURRENT_STATUS.md` if needed
5. Recommend a new git checkpoint commit
