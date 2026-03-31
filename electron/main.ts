import { app, BrowserWindow, Menu, shell, dialog } from "electron";
import pkg from "electron-updater";
const { autoUpdater } = pkg;
import { spawn } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// In dev:       dist-electron/main.js  → __dirname = <root>/dist-electron/
// In packaged:  resources/app/dist-electron/main.js → same relative structure
// Either way, "../dist" resolves to the compiled KaiBot source.

// ---------------------------------------------------------------------------
// Lazy imports from compiled KaiBot source
// These are loaded after app is ready so Electron is fully initialized first.
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
const PORT = 8500;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" as const } : { role: "quit" as const }],
    },
    { role: "editMenu" as const },
    {
      role: "viewMenu" as const,
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    { role: "windowMenu" as const },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  // ── Start the KaiBot web server ─────────────────────────────────────
  // Import from the compiled KaiBot dist. The relative path works both
  // in dev (dist-electron/ → ../dist/) and in the packaged app
  // (resources/app/dist-electron/ → ../dist/).
  const { WebServer } = await import("../dist/web/WebServer.js");
  const { uiStore } = await import("../dist/ui/store.js");
  const { loadSettings, saveSettings } = await import("../dist/settings.js");
  const { addToPathHistory } = await import("../dist/pathHistory.js");
  const { KaiBot } = await import("../dist/KaiBot.js");
  const { getOpenRouterModel } = await import("../dist/models.js");

  const webServer = new WebServer({
    port: PORT,
    host: "127.0.0.1",
    model: process.env.KAI_MODEL ?? "claude-opus-4-6",
  });

  try {
    await webServer.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      "KaiBot — Startup Error",
      `Could not start the web server on port ${PORT}.\n\n${msg}\n\nIs another instance already running?`,
    );
    app.quit();
    return;
  }

  // ── Wire project activation (same logic as kai_bot.ts "waiting" mode) ──
  webServer.on("project-activated", (resolvedDir: string) => {
    addToPathHistory(resolvedDir);

    const savedSettings = loadSettings(resolvedDir);
    const provider: string = (savedSettings.provider as string) ?? "anthropic";
    const model =
      provider === "openrouter"
        ? getOpenRouterModel()
        : (process.env.KAI_MODEL ?? savedSettings.model ?? "claude-opus-4-6");

    webServer.model = model;

    uiStore.on("model-changed", (newModel: string) => {
      webServer.model = newModel;
      saveSettings(resolvedDir, { ...loadSettings(resolvedDir), model: newModel });
    });

    uiStore.on("provider-changed", (newProvider: string) => {
      saveSettings(resolvedDir, { ...loadSettings(resolvedDir), provider: newProvider });
    });

    const bot = new KaiBot(resolvedDir, model, false, provider as "anthropic" | "openrouter");
    bot.start().catch((botErr: unknown) => {
      const msg = botErr instanceof Error ? botErr.message : String(botErr);
      console.error("KaiBot error:", msg);
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────
  app.on("before-quit", () => {
    webServer.stop().catch(() => {});
  });

  // ── Create the browser window ─────────────────────────────────────────
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Protovate KaiBot",
    backgroundColor: "#0B0F1A",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // No preload needed — we load a localhost URL, not local files
    },
  });

  // Open external links in the system browser, not in the Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  // Intercept navigation away from localhost (e.g. clicking external links)
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
}

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

function setupAutoUpdater(): void {
  // Only run in the packaged app — skip during development
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", () => {
    const choice = dialog.showMessageBoxSync({
      type: "info",
      title: "Update Ready",
      message: "A new version of KaiBot has been downloaded.",
      detail:
        "Restart now to apply the update, or it will be installed automatically when you quit.",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-updater error:", err.message ?? err);
  });

  // Check shortly after launch so the window is visible first
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: Error) => {
      console.error("Update check failed:", err.message);
    });
  }, 3000);
}

// ---------------------------------------------------------------------------
// Single-instance lock — second launch focuses the existing window instead
// of trying to bind port 8500 again.
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // Another instance is already running — signal it to come to front, then exit.
  app.quit();
} else {
  app.on("second-instance", () => {
    // Called on the *first* instance when a second one tries to launch.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  buildMenu();

  // ── Verify Claude Code is installed ────────────────────────────────────
  const { findClaudeExecutable } = await import("../dist/KaiClient.js");
  if (!findClaudeExecutable()) {
    const isWindows = process.platform === "win32";
    const buttons = isWindows
      ? ["Open Download Page", "Install Claude for me", "Quit"]
      : ["Open Download Page", "Quit"];

    const choice = dialog.showMessageBoxSync({
      type: "warning",
      title: "Claude Code Not Found",
      message: "Claude Code Terminal is required but was not found on this system.",
      detail:
        "KaiBot uses Claude Code Terminal to process features with AI.\n\n" +
        "Download and install it from:\nhttps://claude.ai/downloads\n\n" +
        "After installing, relaunch KaiBot.",
      buttons,
      defaultId: 0,
      cancelId: isWindows ? 2 : 1,
    });

    if (choice === 0) {
      // Open download page in browser
      shell.openExternal("https://claude.ai/downloads").catch(() => {});
    } else if (isWindows && choice === 1) {
      // Run the official Claude Code installer via PowerShell
      spawn(
        "powershell",
        ["-NoExit", "-Command", "irm https://claude.ai/install.ps1 | iex"],
        { detached: true, stdio: "ignore" },
      ).unref();
      dialog.showMessageBoxSync({
        type: "info",
        title: "Installing Claude Code",
        message: "Installation started in a PowerShell window.",
        detail: "Wait for the installation to complete, then relaunch KaiBot.",
        buttons: ["OK"],
      });
    }

    app.quit();
    return;
  }

  await createWindow();
  setupAutoUpdater();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
