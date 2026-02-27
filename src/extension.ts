import * as vscode from "vscode";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const NO_DOC = "__NO_DOC__";
const NO_RANGE = "__NO_RANGE__";
const SCRIPT_ERROR_PREFIX = "__SCRIPT_ERROR__|";
const DEFAULT_TOAST_MS = 3000;
let outputChannel: vscode.OutputChannel | null = null;

const logInfo = (message: string): void => {
  if (outputChannel) {
    outputChannel.appendLine(message);
  } else {
    console.log(message);
  }
};

const logError = (message: string, err?: unknown): void => {
  if (outputChannel) {
    const detail =
      err === undefined
        ? ""
        : ` ${err instanceof Error ? err.message : String(err)}`;
    outputChannel.appendLine(`${message}${detail}`);
  } else if (err === undefined) {
    console.error(message);
  } else {
    console.error(message, err);
  }
};

const showToast = (message: string, timeoutMs = DEFAULT_TOAST_MS): void => {
  vscode.window.setStatusBarMessage(message, timeoutMs);
};

async function runXcodeScript(
  script: string,
  successMessage: string,
  errorMessage: string
): Promise<void> {
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script]);
    logInfo(`[Xcode] ${successMessage}`);
    showToast(successMessage);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logError(`[Xcode][error][Run] ${errorMessage}: ${detail}`);
    vscode.window.showErrorMessage(`${errorMessage}. ${detail}`);
  }
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildQueryXcodeSelectionScript(): string {
  return [
    'tell application "Xcode"',
    "try",
    'if (count of windows) is 0 then return "' + NO_DOC + '"',
    "set winName to name of window 1",
    'set docName to ""',
    'set sep to " — "',
    "if winName contains sep then",
    "set AppleScript's text item delimiters to sep",
    "set docName to text item 2 of winName",
    'set AppleScript\'s text item delimiters to ""',
    "end if",
    'if docName is "" then return "' + NO_DOC + '"',
    "set foundDoc to missing value",
    "repeat with aDoc in (every source document)",
    "if (name of aDoc) = docName then",
    "set foundDoc to aDoc",
    "exit repeat",
    "end if",
    "end repeat",
    'if foundDoc is missing value then return "' + NO_DOC + '"',
    "set p to path of foundDoc",
    "set r to selected paragraph range of foundDoc",
    "if r is {} then set r to selected character range of foundDoc",
    'if r is {} or (count of r) < 2 then return "' + NO_RANGE + '"',
    'return p & "|" & (item 1 of r) & "|" & (item 2 of r)',
    "on error errMsg",
    `return "${SCRIPT_ERROR_PREFIX}" & errMsg`,
    "end try",
    "end tell",
  ].join("\n");
}

function buildSetXcodeSelectionScript(
  filePath: string,
  start: number,
  end: number
): string {
  const escapedPath = escapeAppleScriptString(filePath);
  return [
    `set filePath to "${escapedPath}"`,
    'tell application "Xcode"',
    "set doc to missing value",
    "repeat 3 times",
    "repeat with d in source documents",
    "if (path of d) is filePath then",
    "set doc to d",
    "exit repeat",
    "end if",
    "end repeat",
    "if doc is not missing value then exit repeat",
    "delay 0.1",
    "end repeat",
    "if doc is missing value then",
    'do shell script "open -g -a Xcode " & quoted form of filePath',
    "repeat 3 times",
    "repeat with d in source documents",
    "if (path of d) is filePath then",
    "set doc to d",
    "exit repeat",
    "end if",
    "end repeat",
    "if doc is not missing value then exit repeat",
    "delay 0.1",
    "end repeat",
    "end if",
    'if doc is missing value then error "Document not found in Xcode: " & filePath',
    `hack document doc start ${start} stop ${end}`,
    "end tell",
  ].join("\n");
}

type XcodeQueryErrorKind = "permission" | "osascript";

async function queryXcodeSelection(): Promise<{
  value: string;
  error: string | null;
  errorKind: XcodeQueryErrorKind | null;
}> {
  const script = buildQueryXcodeSelectionScript();
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-e",
      script,
    ]);
    return { value: stdout.trim(), error: null, errorKind: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const combined = `${message}\n${stderr}`.toLowerCase();
    const combinedRaw = `${message}\n${stderr}`;
    const isPermission =
      combined.includes("not authorized") ||
      combined.includes("not authorised") ||
      combined.includes("not permitted") ||
      combined.includes("1743");
    return {
      value: "",
      error: message || stderr || "osascript failed",
      errorKind: isPermission ? "permission" : "osascript",
    };
  }
}

function buildXcodeWorkspacesScript(): string {
  return [
    'tell application "Xcode"',
    "try",
    'if (count of workspace documents) is 0 then return ""',
    "set results to {}",
    "repeat with w in workspace documents",
    "set wfile to file of w",
    "if wfile is missing value then",
    'set end of results to (name of w) & "|"',
    "else",
    'set end of results to (name of w) & "|" & (POSIX path of wfile)',
    "end if",
    "end repeat",
    "set AppleScript's text item delimiters to linefeed",
    "return results as text",
    "on error errMsg",
    `return "${SCRIPT_ERROR_PREFIX}" & errMsg`,
    "end try",
    "end tell",
  ].join("\n");
}

async function queryXcodeWorkspaces(): Promise<{
  value: string;
  error: string | null;
  errorKind: XcodeQueryErrorKind | null;
}> {
  const script = buildXcodeWorkspacesScript();
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-e",
      script,
    ]);
    return { value: stdout.trim(), error: null, errorKind: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const combined = `${message}\n${stderr}`.toLowerCase();
    const combinedRaw = `${message}\n${stderr}`;
    const isPermission =
      combined.includes("not authorized") ||
      combined.includes("not authorised") ||
      combined.includes("not permitted") ||
      combined.includes("1743") ||
      combinedRaw.includes("未获得授权") ||
      combinedRaw.includes("没有获得授权");
    return {
      value: "",
      error: message || stderr || "osascript failed",
      errorKind: isPermission ? "permission" : "osascript",
    };
  }
}

function parseXcodeWorkspacePaths(value: string): string[] {
  if (!value.trim()) {
    return [];
  }
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.lastIndexOf("|");
      return idx === -1 ? "" : line.slice(idx + 1).trim();
    })
    .filter(Boolean);
}

function getWorkspaceFolderForPath(
  filePath: string
): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
}

async function normalizePathForCompare(filePath: string): Promise<string> {
  const normalized = path.normalize(filePath);
  const resolved = await fs.realpath(normalized).catch(() => normalized);
  if (resolved !== normalized) {
    logInfo(`[Path] realpath ${normalized} -> ${resolved}`);
  }
  return resolved;
}

async function mapPathViaWorkspaceSymlink(
  filePath: string,
  workspaceRoot: string
): Promise<string | null> {
  try {
    const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isSymbolicLink()) {
        continue;
      }
      const linkPath = path.join(workspaceRoot, entry.name);
      const target = await fs.realpath(linkPath).catch(() => "");
      if (!target) {
        continue;
      }
      if (filePath === target || filePath.startsWith(`${target}${path.sep}`)) {
        const relative = path.relative(target, filePath);
        const mapped = path.join(linkPath, relative);
        logInfo(`[Path] map symlink ${filePath} -> ${mapped}`);
        return mapped;
      }
    }
  } catch (err) {
    logError(`[Path] failed to scan symlinks in ${workspaceRoot}`, err);
  }
  return null;
}

async function isPathWithinRoot(
  targetPath: string,
  rootPath: string
): Promise<boolean> {
  const [normalizedFile, normalizedRoot] = await Promise.all([
    normalizePathForCompare(targetPath),
    normalizePathForCompare(rootPath),
  ]);
  if (normalizedFile === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : `${normalizedRoot}${path.sep}`;
  return normalizedFile.startsWith(rootWithSep);
}

async function getWorkspaceFolderForPathNormalized(
  filePath: string
): Promise<vscode.WorkspaceFolder | undefined> {
  const directMatch = getWorkspaceFolderForPath(filePath);
  if (directMatch) {
    return directMatch;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return undefined;
  }
  const normalizedFile = await normalizePathForCompare(filePath);
  for (const folder of folders) {
    const normalizedRoot = await normalizePathForCompare(folder.uri.fsPath);
    if (normalizedFile === normalizedRoot) {
      return folder;
    }
    const rootWithSep = normalizedRoot.endsWith(path.sep)
      ? normalizedRoot
      : `${normalizedRoot}${path.sep}`;
    if (normalizedFile.startsWith(rootWithSep)) {
      return folder;
    }
  }
  return undefined;
}

async function syncToVSCode(
  path: string,
  start: number,
  end: number
): Promise<void> {
  try {
    const uri = vscode.Uri.file(path);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: !vscode.window.state.focused,
    });

    // Convert to VSCode 0-based line number
    const startLine = Math.max(0, start - 1);
    const endLine = Math.max(0, end - 1);

    // Get the end position of the line
    const startPos = new vscode.Position(startLine, 0);
    const endLineObj = doc.lineAt(Math.min(endLine, doc.lineCount - 1));
    const endPos = endLineObj.range.end;

    // Set the selection range
    const selection = new vscode.Selection(startPos, endPos);
    editor.selection = selection;
    editor.revealRange(
      selection,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    logInfo(`[Xcode -> VSCode] Synced selection ${path} ${start}-${end}`);
  } catch (err) {
    logError("Failed to sync to VSCode:", err);
  }
}

async function syncToXcode(
  path: string,
  start: number,
  end: number
): Promise<void> {
  const script = buildSetXcodeSelectionScript(path, start, end);
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script]);
    logInfo(`[VSCode -> Xcode] Sent selection ${path} ${start}-${end}`);
  } catch (err) {
    logError("Failed to sync to Xcode:", err);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Bifrost");
  context.subscriptions.push(outputChannel);
  logInfo('Bifrost extension activated. Use "Bifrost: Start" to begin.');

  let lastValue = "";
  let lastError = "";
  let lastErrorKind: XcodeQueryErrorKind | null = null;
  let lastEmptyAt = 0;
  let timer: NodeJS.Timeout | null = null;
  let isWatching = false;
  let pendingXcodeSync: NodeJS.Timeout | null = null;
  let lastVsCodePayload = "";
  let lastVsCodePayloadNormalized = "";
  let lastWorkspaceSkipAt = 0;
  let syncXcodeToVSCode = true;
  let syncVSCodeToXcode = true;

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "bifrost.toggle";
  statusBarItem.text = "$(circle-slash) Bifrost";
  statusBarItem.tooltip = "Click to start Bifrost";
  statusBarItem.show();

  const xToVStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99
  );
  xToVStatusBarItem.command = "bifrost.toggleXcodeToVSCode";

  const vToXStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    98
  );
  vToXStatusBarItem.command = "bifrost.toggleVSCodeToXcode";

  const xcodeRunStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    200
  );
  xcodeRunStatusBarItem.command = "bifrost.xcodeRun";
  xcodeRunStatusBarItem.text = "$(play) Xcode Run";
  xcodeRunStatusBarItem.tooltip = "Xcode Run";
  xcodeRunStatusBarItem.show();

  const xcodeBuildStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    199
  );
  xcodeBuildStatusBarItem.command = "bifrost.xcodeBuild";
  xcodeBuildStatusBarItem.text = "$(tools) Xcode Build";
  xcodeBuildStatusBarItem.tooltip = "Xcode Build";
  xcodeBuildStatusBarItem.show();

  const updateUI = () => {
    if (isWatching) {
      statusBarItem.text = "$(sync~spin) Bifrost";
      statusBarItem.tooltip = "Bifrost is running. Click to stop.";

      xToVStatusBarItem.text = syncXcodeToVSCode
        ? "$(check) X→V"
        : "$(circle-slash) X→V";
      xToVStatusBarItem.tooltip = syncXcodeToVSCode
        ? "Xcode→VSCode sync ON. Click to disable."
        : "Xcode→VSCode sync OFF. Click to enable.";
      xToVStatusBarItem.show();

      vToXStatusBarItem.text = syncVSCodeToXcode
        ? "$(check) V→X"
        : "$(circle-slash) V→X";
      vToXStatusBarItem.tooltip = syncVSCodeToXcode
        ? "VSCode→Xcode sync ON. Click to disable."
        : "VSCode→Xcode sync OFF. Click to enable.";
      vToXStatusBarItem.show();
    } else {
      statusBarItem.text = "$(circle-slash) Bifrost";
      statusBarItem.tooltip = "Bifrost is stopped. Click to start.";
      xToVStatusBarItem.hide();
      vToXStatusBarItem.hide();
    }
  };

  // Polls Xcode for selection changes and syncs to VSCode
  const startPolling = () => {
    const intervalMs = 500;
    let isPolling = false;
    return setInterval(async () => {
      if (!isWatching) {
        return;
      }
      if (vscode.window.state.focused) {
        return;
      }
      if (isPolling) {
        return;
      }
      isPolling = true;
      try {
        const { value, error, errorKind } = await queryXcodeSelection();

        if (error) {
          if (error !== lastError || errorKind !== lastErrorKind) {
            lastError = error;
            lastErrorKind = errorKind;
            if (errorKind === "permission") {
              const message =
                "Bifrost is not authorized to control Xcode. Enable it in System Settings > Privacy & Security > Automation.";
              logInfo(`[Xcode][permission] ${message}`);
              vscode.window
                .showWarningMessage(message, "Open System Settings")
                .then((selection) => {
                  if (selection === "Open System Settings") {
                    execFileAsync("/usr/bin/open", [
                      "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
                    ]);
                  }
                });
            } else {
              logInfo(`[Xcode][error] ${error}`);
            }
          }
          return;
        }

        if (value === NO_DOC) {
          const now = Date.now();
          if (now - lastEmptyAt > 5000) {
            lastEmptyAt = now;
            logInfo("[Xcode] No active source document.");
          }
          return;
        }

        if (value === NO_RANGE) {
          const now = Date.now();
          if (now - lastEmptyAt > 5000) {
            lastEmptyAt = now;
            logInfo("[Xcode] No selection range available.");
          }
          return;
        }

        if (value.startsWith(SCRIPT_ERROR_PREFIX)) {
          const errMsg = value.slice(SCRIPT_ERROR_PREFIX.length).trim();
          if (errMsg !== lastError) {
            lastError = errMsg;
            lastErrorKind = "osascript";
            logInfo(`[Xcode][error] ${errMsg || "AppleScript error"}`);
          }
          return;
        }

        lastError = "";
        lastErrorKind = null;
        if (value !== lastValue) {
          lastValue = value;
          const [path, startStr, endStr] = value.split("|");
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          logInfo(`[Xcode] ${path} ${start}-${end}`);

          const normalizedPath = await normalizePathForCompare(path);
          let vscodePath = normalizedPath;
          let workspaceFolder = await getWorkspaceFolderForPathNormalized(
            normalizedPath
          );
          if (!workspaceFolder) {
            const folders = vscode.workspace.workspaceFolders ?? [];
            for (const folder of folders) {
              const mapped = await mapPathViaWorkspaceSymlink(
                normalizedPath,
                folder.uri.fsPath
              );
              if (mapped) {
                vscodePath = mapped;
                workspaceFolder = folder;
                break;
              }
            }
          }
          if (!workspaceFolder) {
            const now = Date.now();
            if (now - lastWorkspaceSkipAt > 5000) {
              lastWorkspaceSkipAt = now;
              logInfo(
                "[Xcode -> VSCode] Skip sync: Xcode file not in any VSCode workspace."
              );
            }
            return;
          }

          if (!syncXcodeToVSCode) {
            return;
          }
          await syncToVSCode(vscodePath, start, end);
        }
      } finally {
        isPolling = false;
      }
    }, intervalMs);
  };

  // Schedules a sync to Xcode for the given editor
  const scheduleSyncToXcode = (editor: vscode.TextEditor | undefined) => {
    if (!isWatching) {
      return;
    }
    if (!syncVSCodeToXcode) {
      return;
    }
    if (!editor) {
      logInfo("[VSCode -> Xcode] Skip sync: no active editor.");
      return;
    }
    if (!vscode.window.state.focused) {
      return;
    }
    if (editor.document.uri.scheme !== "file") {
      return;
    }

    const selection = editor.selection;
    const isEmpty = selection.isEmpty;
    const startLine = isEmpty
      ? selection.active.line + 1
      : Math.min(selection.start.line, selection.end.line) + 1;
    const endLine = isEmpty
      ? selection.active.line + 1
      : Math.max(selection.start.line, selection.end.line) + 1;
    const filePath = editor.document.uri.fsPath;
    const payload = `${filePath}|${startLine}|${endLine}`;

    if (payload === lastVsCodePayload) {
      logInfo("[VSCode -> Xcode] Skip sync: selection unchanged.");
      return;
    }
    lastVsCodePayload = payload;

    if (pendingXcodeSync) {
      clearTimeout(pendingXcodeSync);
    }
    pendingXcodeSync = setTimeout(() => {
      void (async () => {
        if (!syncVSCodeToXcode) {
          return;
        }
        if (!vscode.window.state.focused) {
          logInfo("[VSCode -> Xcode] Skip sync: lost focus before sending.");
          return;
        }

        const vsWorkspaceFolder = getWorkspaceFolderForPath(filePath);
        if (!vsWorkspaceFolder) {
          logInfo(
            "[VSCode -> Xcode] Skip sync: file not in any VSCode workspace."
          );
          return;
        }
        const normalizedFilePath = await normalizePathForCompare(filePath);
        const normalizedPayload = `${normalizedFilePath}|${startLine}|${endLine}`;
        if (normalizedPayload === lastVsCodePayloadNormalized) {
          logInfo("[VSCode -> Xcode] Skip sync: selection unchanged.");
          return;
        }
        lastVsCodePayloadNormalized = normalizedPayload;
        logInfo(
          `[VSCode -> Xcode][debug] VSCode workspace: ${vsWorkspaceFolder.uri.fsPath}`
        );

        const { value, error, errorKind } = await queryXcodeWorkspaces();
        if (error) {
          if (errorKind === "permission") {
            logInfo(
              "[Xcode][permission] Missing permission to read Xcode workspaces."
            );
          } else {
            logInfo(`[Xcode][error][Workspaces] ${error}`);
          }
          return;
        }
        if (!value.trim() || value.startsWith(SCRIPT_ERROR_PREFIX)) {
          logInfo("[VSCode -> Xcode] Skip sync: Xcode has no open workspace.");
          return;
        }

        const workspacePaths = parseXcodeWorkspacePaths(value);
        logInfo(
          `[VSCode -> Xcode][debug] Xcode workspaces: ${workspacePaths.join(
            ", "
          )}`
        );
        const vsRootPath = vsWorkspaceFolder.uri.fsPath;
        let hasMatch = false;
        for (const workspacePath of workspacePaths) {
          const rootPath = path.dirname(workspacePath);
          const isMatch =
            (await isPathWithinRoot(filePath, rootPath)) ||
            (await isPathWithinRoot(rootPath, vsRootPath));
          logInfo(
            `[VSCode -> Xcode][debug] Check ${rootPath} -> ${
              isMatch ? "match" : "no"
            }`
          );
          if (isMatch) {
            hasMatch = true;
            break;
          }
        }
        if (!hasMatch) {
          logInfo(
            "[VSCode -> Xcode] Skip sync: Xcode workspace does not match VSCode."
          );
          return;
        }

        syncToXcode(normalizedFilePath, startLine, endLine);
      })();
    }, 200);
  };

  const selectionListener = vscode.window.onDidChangeTextEditorSelection(
    (event) => {
      scheduleSyncToXcode(event.textEditor);
    }
  );

  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      scheduleSyncToXcode(editor);
    }
  );

  const startCommand = vscode.commands.registerCommand("bifrost.start", () => {
    if (isWatching) {
      showToast("Bifrost is already running.");
      return;
    }

    isWatching = true;
    timer = startPolling();
    outputChannel?.show(true);
    updateUI();
    logInfo("[Bifrost] Started watching Xcode.");
    showToast("Bifrost started.");
  });

  const stopCommand = vscode.commands.registerCommand("bifrost.stop", () => {
    if (!isWatching) {
      showToast("Bifrost is not running.");
      return;
    }

    isWatching = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (pendingXcodeSync) {
      clearTimeout(pendingXcodeSync);
      pendingXcodeSync = null;
    }
    lastValue = "";
    lastError = "";
    lastErrorKind = null;
    lastEmptyAt = 0;
    lastVsCodePayload = "";
    lastVsCodePayloadNormalized = "";
    lastWorkspaceSkipAt = 0;
    updateUI();
    logInfo("[Bifrost] Stopped watching Xcode.");
    showToast("Bifrost stopped.");
  });

  const toggleCommand = vscode.commands.registerCommand(
    "bifrost.toggle",
    () => {
      if (isWatching) {
        vscode.commands.executeCommand("bifrost.stop");
      } else {
        vscode.commands.executeCommand("bifrost.start");
      }
    }
  );

  const toggleXcodeToVSCodeCommand = vscode.commands.registerCommand(
    "bifrost.toggleXcodeToVSCode",
    () => {
      syncXcodeToVSCode = !syncXcodeToVSCode;
      updateUI();
      logInfo(
        `[Bifrost] Xcode→VSCode sync ${
          syncXcodeToVSCode ? "enabled" : "disabled"
        }.`
      );
      showToast(
        `Xcode→VSCode sync ${syncXcodeToVSCode ? "enabled" : "disabled"}.`
      );
    }
  );

  const toggleVSCodeToXcodeCommand = vscode.commands.registerCommand(
    "bifrost.toggleVSCodeToXcode",
    () => {
      syncVSCodeToXcode = !syncVSCodeToXcode;
      updateUI();
      logInfo(
        `[Bifrost] VSCode→Xcode sync ${
          syncVSCodeToXcode ? "enabled" : "disabled"
        }.`
      );
      showToast(
        `VSCode→Xcode sync ${syncVSCodeToXcode ? "enabled" : "disabled"}.`
      );
    }
  );

  // Xcode Run
  const runCommand = vscode.commands.registerCommand("bifrost.xcodeRun", () => {
    runXcodeScript(
      [
        "set frontApp to (path to frontmost application as text)",
        'tell application "Xcode" to activate',
        "delay 0.1",
        'tell application "System Events"',
        'tell process "Xcode"',
        'keystroke "r" using {command down}',
        "end tell",
        "end tell",
        "tell application frontApp to activate",
      ].join("\n"),
      "Bifrost: Xcode Run triggered!",
      "Failed to trigger Xcode Run"
    );
  });

  // Xcode Build
  const buildCommand = vscode.commands.registerCommand(
    "bifrost.xcodeBuild",
    () => {
      runXcodeScript(
        [
          "set frontApp to (path to frontmost application as text)",
          'tell application "Xcode" to activate',
          "delay 0.1",
          'tell application "System Events"',
          'tell process "Xcode"',
          'keystroke "b" using {command down}',
          "end tell",
          "end tell",
          "tell application frontApp to activate",
        ].join("\n"),
        "Bifrost: Xcode Build triggered!",
        "Failed to trigger Xcode Build"
      );
    }
  );

  context.subscriptions.push(
    statusBarItem,
    xToVStatusBarItem,
    vToXStatusBarItem,
    xcodeRunStatusBarItem,
    xcodeBuildStatusBarItem,
    startCommand,
    stopCommand,
    toggleCommand,
    toggleXcodeToVSCodeCommand,
    toggleVSCodeToXcodeCommand,
    runCommand,
    buildCommand,
    selectionListener,
    activeEditorListener,
    {
      dispose: () => {
        if (timer) {
          clearInterval(timer);
        }
        if (pendingXcodeSync) {
          clearTimeout(pendingXcodeSync);
        }
      },
    }
  );
}

export function deactivate(): void {}
