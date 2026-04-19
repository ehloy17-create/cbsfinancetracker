# Restore Guide

## Before any change
Create a checkpoint first.

### If git is already initialized
Run:

```bash
git add .
git commit -m "checkpoint before AI changes"
git branch backup-working-build
```

### If git is not initialized
Run:

```bash
git init
git add .
git commit -m "initial checkpoint before AI changes"
git branch backup-working-build
```

## Restore current branch to last commit
```bash
git reset --hard HEAD
```

## Restore a specific backup branch
```bash
git checkout backup-working-build
```

## Discard only uncommitted file changes
```bash
git restore .
```

## Rule for AI
No edits are allowed before a restore point is available.
