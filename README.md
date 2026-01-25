# Bifrost

Enhance collaboration between Xcode and VSCode/Cursor.

> **Why Bifrost?** Named after the [rainbow bridge in Norse mythology](https://en.wikipedia.org/wiki/Bifr%C3%B6st) that connects different realms — just as this extension bridges Xcode and VSCode/Cursor.

## Features

### File/Selection Sync

Bifrost keeps Xcode and Cursor/VSCode in sync for the currently opened file and selection.

- Monitors Xcode's currently opened file and selected lines
- Automatically opens the same file in VSCode/Cursor
- Syncs cursor selection to match Xcode

#### Usage

1. Open Command Palette (Command+Shift+P)
2. Run `Xcode Sync: Start` to begin monitoring
3. Switch files or select code in Xcode
4. VSCode/Cursor will automatically sync
5. Run `Xcode Sync: Stop` to stop monitoring

### Xcode Run

Bifrost lets you build and run your Xcode project from Cursor/VSCode.

- Open Xcode and configure a destination
- Back in Cursor/VSCode, `Command+Shift+P` → search for `Xcode Run`
- Use the Xcode Run/Build buttons in the Cursor/VSCode status bar



## Requirements

- macOS
- Xcode installed
- Permission to control Xcode via AppleScript (will prompt on first use)

## Installation

Install the `.vsix` file via Cursor/VSCode: `Command+Shift+P` → search for `Install from VSIX`