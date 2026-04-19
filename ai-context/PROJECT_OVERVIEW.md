# Project Overview

## Project Name
BizTracker

## Purpose
BizTracker is a business operations and finance application. It includes dashboard and finance-related widgets and is being prepared for stable Windows deployment.

## Current Known Environment
- Development environment: VS Code
- AI coding assistants used: GitHub Copilot and Claude
- Platform target: Windows desktop deployment
- Installed target path: `C:\Program Files\BizTracker`
- Updater bundle path used during update testing: `D:\CBSDEV\biztracker-updater-bundle`

## Major Areas
- Dashboard UI
- Finance widget area
- Menus widget area
- Other detailed sections below the main widgets
- Updater / installed build flow
- Localhost/dev loading behavior
- Packaged app behavior

## Important Known Issue History
A previously observed issue showed the app attempting to load:

`http://localhost:4010/`

This suggests the app may still be loading a dev server URL in a packaged or installed environment, instead of loading the production-built frontend files.

## High Priority Development Principle
Protect the current working build first before making any UI or structural changes.
