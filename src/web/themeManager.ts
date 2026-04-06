import { mkdirSync, rmSync, writeFileSync } from "fs";
import { posix } from "path";

import AdmZip from "adm-zip";

import {
  getGlobalAceThemePath,
  getGlobalSettingsDir,
  getGlobalThemeCssPath,
  type GlobalKaiBotSettings,
} from "../globalSettings.js";

export interface ThemeSearchResult {
  id: string;
  name: string;
  publisher: string;
  extensionName: string;
  version: string;
  lastUpdated: string;
  installCount: number;
  assetUri: string;
  fallbackAssetUri: string;
}

export interface ThemeSearchResponse {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  results: ThemeSearchResult[];
}

export interface ThemeApplyInput extends ThemeSearchResult {}

interface ParsedThemeDocument {
  colors: Record<string, string>;
  tokenColors: TokenRule[];
}

interface TokenRule {
  scope?: string | string[];
  settings?: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

const MARKETPLACE_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const MARKETPLACE_FLAGS = 0x192;
const THEME_PAGE_SIZE = 24;

// Default KaiBot palette. theme.css only overrides a subset of these, but the
// values here define the default fallback used during theme generation.
const DEFAULT_THEME_VARS: Record<string, string> = {
  "--kb-bg-primary": "#0b0f1a",
  "--kb-bg-secondary": "#121826",
  "--kb-bg-tertiary": "#1a2233",
  "--kb-bg-elevated": "#243050",
  "--kb-bg-overlay": "rgba(0, 0, 0, 0.6)",
  "--kb-bg-overlay-strong": "rgba(0, 0, 0, 0.72)",
  "--kb-sidebar-bg": "#0b0f1a",
  "--kb-header-bg": "#121826",
  "--kb-status-bg": "#121826",
  "--kb-text": "#ffffff",
  "--kb-text-soft": "#e2e8f0",
  "--kb-text-muted": "#9ca3af",
  "--kb-text-dim": "#6b7280",
  "--kb-text-body": "#d1d5db",
  "--kb-border": "#2a344a",
  "--kb-border-subtle": "#1a2233",
  "--kb-accent": "#3b82f6",
  "--kb-accent-hover": "#2563eb",
  "--kb-accent-strong": "#1d4ed8",
  "--kb-success": "#22c55e",
  "--kb-success-bg": "#0b1a0f",
  "--kb-error": "#ef4444",
  "--kb-error-bg": "#1a0b0b",
  "--kb-warning": "#f59e0b",
  "--kb-warning-bg": "#1a1a0b",
};

export function getThemePageSize(): number {
  return THEME_PAGE_SIZE;
}

export async function searchMarketplaceThemes(query: string, page: number): Promise<ThemeSearchResponse> {
  const pageNumber = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const pageOffset = (pageNumber - 1) * THEME_PAGE_SIZE;
  const trimmedQuery = query.trim();

  const criteria = [
    { filterType: 8, value: "Microsoft.VisualStudio.Code" },
    { filterType: 5, value: "Themes" },
  ];
  if (trimmedQuery) {
    criteria.push({ filterType: 10, value: trimmedQuery });
  }

  const response = await fetch(MARKETPLACE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json;api-version=7.2-preview.1",
      "User-Agent": "KaiBot Theme Browser",
    },
    body: JSON.stringify({
      filters: [
        {
          criteria,
          pageNumber,
          pageSize: THEME_PAGE_SIZE,
          sortBy: 0,
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      flags: MARKETPLACE_FLAGS,
    }),
  });

  if (!response.ok) {
    throw new Error(`Marketplace search failed (${response.status})`);
  }

  const payload = await response.json() as {
    results?: Array<{
      extensions?: MarketplaceExtension[];
      resultMetadata?: Array<{ metadataType?: string; metadataItems?: Array<{ name?: string; count?: number }> }>;
    }>;
  };

  const bucket = payload.results?.[0];
  const extensions = bucket?.extensions ?? [];
  const total = extractMarketplaceTotal(bucket) ?? (pageOffset + extensions.length);
  const pagedResults = extensions.map(normalizeMarketplaceExtension);
  const hasMore = total > 0 ? pageOffset + pagedResults.length < total : pagedResults.length === THEME_PAGE_SIZE;

  return {
    query: trimmedQuery,
    page: pageNumber,
    pageSize: THEME_PAGE_SIZE,
    total,
    hasMore,
    results: pagedResults,
  };
}

export async function applyMarketplaceTheme(
  theme: ThemeApplyInput,
  currentSettings: GlobalKaiBotSettings,
): Promise<GlobalKaiBotSettings> {
  const vsixBuffer = await downloadVsix(theme);
  const zip = new AdmZip(vsixBuffer);
  const packageJsonPath = findZipEntry(zip, "extension/package.json");
  if (!packageJsonPath) {
    throw new Error("Theme package did not contain extension/package.json");
  }

  const packageJson = parseJsonDocument(readZipText(zip, packageJsonPath), packageJsonPath) as {
    contributes?: {
      themes?: Array<{
        label?: string;
        path?: string;
        uiTheme?: string;
      }>;
    };
  };

  const contribution = chooseThemeContribution(packageJson.contributes?.themes ?? []);
  if (!contribution?.path) {
    throw new Error("Theme package did not declare any usable themes");
  }

  const packageDir = posix.dirname(packageJsonPath);
  const themePath = normalizeZipPath(posix.join(packageDir, contribution.path));
  const parsedTheme = loadThemeDocument(zip, themePath, new Set<string>());
  const themeVars = buildThemeVariables(parsedTheme.colors);

  mkdirSync(getGlobalSettingsDir(), { recursive: true });
  writeFileSync(getGlobalThemeCssPath(), renderThemeCss(themeVars), "utf8");
  writeFileSync(getGlobalAceThemePath(), renderAceThemeModule(parsedTheme, themeVars), "utf8");

  return {
    ...currentSettings,
    theme: {
      id: theme.id,
      name: contribution.label?.trim() || theme.name,
    },
  };
}

export function resetMarketplaceTheme(currentSettings: GlobalKaiBotSettings): GlobalKaiBotSettings {
  rmSync(getGlobalThemeCssPath(), { force: true });
  rmSync(getGlobalAceThemePath(), { force: true });
  const next = { ...currentSettings };
  delete next.theme;
  return next;
}

export function renderThemeCss(themeVars: Record<string, string>): string {
  const lines = Object.entries(themeVars).map(([key, value]) => `  ${key}: ${value};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

export function renderEmptyAceThemeModule(): string {
  return "window.__KAIBOT_ACE_THEME_NAME = \"ace/theme/tomorrow_night\";\n";
}

interface MarketplaceExtension {
  displayName?: string;
  extensionName?: string;
  lastUpdated?: string;
  publisher?: { publisherName?: string; displayName?: string };
  statistics?: Array<{ statisticName?: string; value?: number }>;
  versions?: Array<{ version?: string; assetUri?: string; fallbackAssetUri?: string }>;
}

function extractMarketplaceTotal(bucket: {
  resultMetadata?: Array<{ metadataType?: string; metadataItems?: Array<{ name?: string; count?: number }> }>;
} | undefined): number | null {
  const metadata = bucket?.resultMetadata ?? [];
  for (const item of metadata) {
    for (const metadataItem of item.metadataItems ?? []) {
      if (metadataItem.name === "TotalCount" && typeof metadataItem.count === "number") {
        return metadataItem.count;
      }
    }
  }
  return null;
}

function normalizeMarketplaceExtension(extension: MarketplaceExtension): ThemeSearchResult {
  const publisher = extension.publisher?.publisherName || extension.publisher?.displayName || "unknown";
  const extensionName = extension.extensionName || "theme";
  const latestVersion = extension.versions?.[0];
  if (!latestVersion?.assetUri && !latestVersion?.fallbackAssetUri) {
    throw new Error("Marketplace response did not include a downloadable theme package");
  }

  return {
    id: `${publisher}.${extensionName}`,
    name: extension.displayName || extensionName,
    publisher,
    extensionName,
    version: latestVersion.version || "latest",
    lastUpdated: extension.lastUpdated || "",
    installCount: readInstallCount(extension.statistics),
    assetUri: latestVersion.assetUri || latestVersion.fallbackAssetUri || "",
    fallbackAssetUri: latestVersion.fallbackAssetUri || latestVersion.assetUri || "",
  };
}

function readInstallCount(stats: MarketplaceExtension["statistics"]): number {
  for (const stat of stats ?? []) {
    if (stat.statisticName === "install" && typeof stat.value === "number") {
      return stat.value;
    }
  }
  return 0;
}

async function downloadVsix(theme: ThemeApplyInput): Promise<Buffer> {
  const baseUri = theme.assetUri || theme.fallbackAssetUri;
  if (!baseUri) {
    throw new Error("Theme package did not include a download URL");
  }
  const packageUrl = `${baseUri}/Microsoft.VisualStudio.Services.VSIXPackage`;
  const response = await fetch(packageUrl, {
    headers: { "User-Agent": "KaiBot Theme Browser" },
  });
  if (!response.ok) {
    throw new Error(`Failed to download theme package (${response.status})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function chooseThemeContribution(themes: Array<{ label?: string; path?: string; uiTheme?: string }>): {
  label?: string;
  path?: string;
  uiTheme?: string;
} | null {
  if (themes.length === 0) return null;
  return themes.find((item) => /dark/i.test(item.uiTheme || "")) || themes[0];
}

function loadThemeDocument(zip: AdmZip, entryPath: string, visited: Set<string>): ParsedThemeDocument {
  const normalizedPath = normalizeZipPath(entryPath);
  if (visited.has(normalizedPath)) {
    throw new Error("Theme package contains a recursive include");
  }
  visited.add(normalizedPath);

  if (normalizedPath.toLowerCase().endsWith(".tmtheme")) {
    return parseTmTheme(readZipText(zip, normalizedPath));
  }

  const raw = readZipText(zip, normalizedPath);
  const parsed = parseJsonDocument(raw, normalizedPath) as {
    include?: string;
    colors?: Record<string, string>;
    tokenColors?: TokenRule[] | string;
  };

  const base = parsed.include
    ? loadThemeDocument(zip, normalizeZipPath(posix.join(posix.dirname(normalizedPath), parsed.include)), visited)
    : { colors: {}, tokenColors: [] };

  let parsedTokenColors: TokenRule[] = base.tokenColors.slice();
  if (typeof parsed.tokenColors === "string") {
    const nested = loadThemeDocument(zip, normalizeZipPath(posix.join(posix.dirname(normalizedPath), parsed.tokenColors)), visited);
    parsedTokenColors = parsedTokenColors.concat(nested.tokenColors);
  } else if (Array.isArray(parsed.tokenColors)) {
    parsedTokenColors = parsedTokenColors.concat(parsed.tokenColors);
  }

  return {
    colors: {
      ...base.colors,
      ...sanitizeColorMap(parsed.colors),
    },
    tokenColors: parsedTokenColors,
  };
}

function parseTmTheme(raw: string): ParsedThemeDocument {
  const colors: Record<string, string> = {};
  const globalSettingsMatch = raw.match(/<key>settings<\/key>\s*<array>\s*<dict>\s*<key>settings<\/key>\s*<dict>([\s\S]*?)<\/dict>/i);
  const block = globalSettingsMatch?.[1] ?? "";
  colors["editor.background"] = readTmThemeValue(block, "background") || DEFAULT_THEME_VARS["--kb-bg-primary"];
  colors["editor.foreground"] = readTmThemeValue(block, "foreground") || DEFAULT_THEME_VARS["--kb-text"];
  colors["editor.selectionBackground"] = readTmThemeValue(block, "selection") || alphaColor(colors["editor.foreground"], 0.18);
  colors["editorCursor.foreground"] = readTmThemeValue(block, "caret") || DEFAULT_THEME_VARS["--kb-accent"];
  return { colors, tokenColors: [] };
}

function readTmThemeValue(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`<key>${escapeRegExp(key)}<\\/key>\\s*<string>([^<]+)<\\/string>`, "i"));
  return sanitizeColor(match?.[1]);
}

function parseJsonDocument(raw: string, source: string): unknown {
  try {
    return JSON.parse(stripJsonComments(raw).replace(/,\s*([}\]])/g, "$1"));
  } catch {
    throw new Error(`Could not parse theme file ${source}`);
  }
}

function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const curr = input[i];
    const next = input[i + 1];
    const prev = input[i - 1];

    if (inLineComment) {
      if (curr === "\n") {
        inLineComment = false;
        out += curr;
      }
      continue;
    }

    if (inBlockComment) {
      if (curr === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (!inString && curr === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (!inString && curr === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (curr === "\"" && prev !== "\\") {
      inString = !inString;
    }

    out += curr;
  }

  return out;
}

function sanitizeColorMap(input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    const sanitized = sanitizeColor(value);
    if (sanitized) out[key] = sanitized;
  }
  return out;
}

function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  if (/^(rgba?|hsla?)\([^)]+\)$/i.test(trimmed)) return trimmed;
  return undefined;
}

function buildThemeVariables(colors: Record<string, string>): Record<string, string> {
  const bgPrimary = colors["editor.background"] || DEFAULT_THEME_VARS["--kb-bg-primary"];
  const textPrimary = colors["editor.foreground"] || DEFAULT_THEME_VARS["--kb-text"];
  const accent = colors["button.background"]
    || colors["focusBorder"]
    || colors["list.activeSelectionBackground"]
    || DEFAULT_THEME_VARS["--kb-accent"];
  const headerBg = colors["activityBar.background"] || colors["titleBar.activeBackground"] || shiftColor(bgPrimary, 0.08);
  const sidebarBg = colors["sideBar.background"] || colors["editorGroupHeader.tabsBackground"] || shiftColor(bgPrimary, 0.05);
  const statusBg = colors["statusBar.background"] || headerBg;
  const bgSecondary = colors["input.background"] || colors["dropdown.background"] || shiftColor(sidebarBg, 0.06);
  const bgTertiary = colors["tab.inactiveBackground"] || colors["editorWidget.background"] || shiftColor(bgSecondary, 0.06);
  const bgElevated = colors["tab.activeBackground"] || colors["list.activeSelectionBackground"] || shiftColor(bgTertiary, 0.08);
  const textSoft = colors["sideBar.foreground"] || colors["input.foreground"] || mixColor(textPrimary, "#ffffff", 0.86);
  const textMuted = colors["descriptionForeground"] || colors["input.placeholderForeground"] || mixColor(textPrimary, bgPrimary, 0.62);
  const textDim = colors["editorLineNumber.foreground"] || mixColor(textPrimary, bgPrimary, 0.44);
  const border = colors["panel.border"] || colors["sideBar.border"] || colors["editorGroup.border"] || alphaColor(textPrimary, 0.2);
  const borderSubtle = colors["contrastBorder"] || alphaColor(textPrimary, 0.12);
  const success = colors["terminal.ansiGreen"] || DEFAULT_THEME_VARS["--kb-success"];
  const error = colors["terminal.ansiRed"] || DEFAULT_THEME_VARS["--kb-error"];
  const warning = colors["terminal.ansiYellow"] || DEFAULT_THEME_VARS["--kb-warning"];

  return {
    "--kb-bg-primary": bgPrimary,
    "--kb-bg-secondary": bgSecondary,
    "--kb-bg-tertiary": bgTertiary,
    "--kb-bg-elevated": bgElevated,
    "--kb-bg-deep": colors["editorGroupHeader.tabsBackground"] || shiftColor(bgPrimary, 0.03),
    "--kb-bg-overlay": alphaColor(bgPrimary, 0.82),
    "--kb-bg-overlay-strong": alphaColor(bgPrimary, 0.92),
    "--kb-sidebar-bg": sidebarBg,
    "--kb-header-bg": headerBg,
    "--kb-status-bg": statusBg,
    "--kb-text": textPrimary,
    "--kb-text-soft": textSoft,
    "--kb-text-muted": textMuted,
    "--kb-text-dim": textDim,
    "--kb-text-body": colors["editorGutter.foreground"] || mixColor(textPrimary, "#ffffff", 0.78),
    "--kb-border": border,
    "--kb-border-subtle": borderSubtle,
    "--kb-accent": accent,
    "--kb-accent-hover": colors["button.hoverBackground"] || shiftColor(accent, 0.1),
    "--kb-accent-strong": colors["list.highlightForeground"] || colors["textLink.foreground"] || shiftColor(accent, 0.2),
    "--kb-token-3b82f622": alphaColor(accent, 0.13),
    "--kb-token-0b1a3b22": alphaColor(accent, 0.13),
    "--kb-token-1e293b": border,
    "--kb-token-334155": shiftColor(border, 0.1),
    "--kb-token-374151": shiftColor(textMuted, 0.08),
    "--kb-token-374357": shiftColor(bgElevated, 0.08),
    "--kb-token-111827": shiftColor(bgPrimary, 0.1),
    "--kb-success": success,
    "--kb-success-bg": alphaColor(success, 0.16),
    "--kb-error": error,
    "--kb-error-bg": alphaColor(error, 0.16),
    "--kb-warning": warning,
    "--kb-warning-bg": alphaColor(warning, 0.16),
  };
}

function renderAceThemeModule(parsedTheme: ParsedThemeDocument, themeVars: Record<string, string>): string {
  const keyword = findTokenColor(parsedTheme.tokenColors, ["keyword", "storage", "keyword.operator"]) || themeVars["--kb-accent"];
  const string = findTokenColor(parsedTheme.tokenColors, ["string"]) || themeVars["--kb-warning"];
  const comment = findTokenColor(parsedTheme.tokenColors, ["comment", "punctuation.definition.comment"]) || themeVars["--kb-text-dim"];
  const constant = findTokenColor(parsedTheme.tokenColors, ["constant", "constant.numeric", "constant.language"]) || themeVars["--kb-success"];
  const func = findTokenColor(parsedTheme.tokenColors, ["entity.name.function", "support.function"]) || themeVars["--kb-accent-strong"];
  const variable = findTokenColor(parsedTheme.tokenColors, ["variable", "entity.name.type"]) || themeVars["--kb-text-soft"];
  const invalid = findTokenColor(parsedTheme.tokenColors, ["invalid"]) || themeVars["--kb-error"];
  const selection = parsedTheme.colors["editor.selectionBackground"] || alphaColor(themeVars["--kb-accent"], 0.18);
  const activeLine = parsedTheme.colors["editor.lineHighlightBackground"] || alphaColor(themeVars["--kb-text"], 0.06);

  const cssText = [
    `.ace-kaibot-custom .ace_gutter {background: ${themeVars["--kb-bg-secondary"]}; color: ${themeVars["--kb-text-dim"]};}`,
    `.ace-kaibot-custom .ace_print-margin {width: 1px; background: ${themeVars["--kb-border"]};}`,
    `.ace-kaibot-custom {background-color: ${themeVars["--kb-bg-primary"]}; color: ${themeVars["--kb-text"]};}`,
    `.ace-kaibot-custom .ace_cursor {color: ${parsedTheme.colors["editorCursor.foreground"] || themeVars["--kb-accent"]};}`,
    `.ace-kaibot-custom .ace_marker-layer .ace_selection {background: ${selection};}`,
    `.ace-kaibot-custom .ace_marker-layer .ace_active-line {background: ${activeLine};}`,
    `.ace-kaibot-custom .ace_marker-layer .ace_selected-word {border: 1px solid ${alphaColor(themeVars["--kb-accent"], 0.4)};}`,
    `.ace-kaibot-custom .ace_comment {color: ${comment}; font-style: italic;}`,
    `.ace-kaibot-custom .ace_keyword, .ace-kaibot-custom .ace_meta, .ace-kaibot-custom .ace_storage {color: ${keyword};}`,
    `.ace-kaibot-custom .ace_string {color: ${string};}`,
    `.ace-kaibot-custom .ace_constant, .ace-kaibot-custom .ace_constant.ace_numeric {color: ${constant};}`,
    `.ace-kaibot-custom .ace_entity.ace_name.ace_function, .ace-kaibot-custom .ace_support.ace_function {color: ${func};}`,
    `.ace-kaibot-custom .ace_variable {color: ${variable};}`,
    `.ace-kaibot-custom .ace_invalid {color: ${themeVars["--kb-bg-primary"]}; background-color: ${invalid};}`,
    `.ace-kaibot-custom .ace_fold {background-color: ${themeVars["--kb-accent"]}; border-color: ${themeVars["--kb-text"]};}`,
  ].join("");

  return `ace.define("ace/theme/kaibot_custom",["require","exports","module","ace/lib/dom"],function(require,exports,module){exports.isDark=true;exports.cssClass="ace-kaibot-custom";exports.cssText=${JSON.stringify(cssText)};var dom=require("../lib/dom");dom.importCssString(exports.cssText,exports.cssClass);});\nwindow.__KAIBOT_ACE_THEME_NAME="ace/theme/kaibot_custom";\n`;
}

function findTokenColor(rules: TokenRule[], scopes: string[]): string | undefined {
  for (const scope of scopes) {
    for (const rule of rules) {
      const ruleScopes = normalizeScopes(rule.scope);
      if (ruleScopes.some((item) => item.includes(scope))) {
        const color = sanitizeColor(rule.settings?.foreground);
        if (color) return color;
      }
    }
  }
  return undefined;
}

function normalizeScopes(scope: string | string[] | undefined): string[] {
  if (!scope) return [];
  if (Array.isArray(scope)) return scope;
  return scope.split(",").map((item) => item.trim()).filter(Boolean);
}

function findZipEntry(zip: AdmZip, expectedPath: string): string | undefined {
  const normalized = normalizeZipPath(expectedPath);
  for (const entry of zip.getEntries()) {
    if (normalizeZipPath(entry.entryName) === normalized) {
      return entry.entryName;
    }
  }
  return undefined;
}

function readZipText(zip: AdmZip, entryPath: string): string {
  const actualPath = findZipEntry(zip, entryPath);
  if (!actualPath) {
    throw new Error(`Theme package did not include ${entryPath}`);
  }
  const entry = zip.getEntry(actualPath);
  if (!entry) {
    throw new Error(`Theme package entry ${entryPath} was unreadable`);
  }
  return entry.getData().toString("utf8");
}

function normalizeZipPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function shiftColor(color: string, amount: number): string {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  const fn = amount >= 0 ? lighten : darken;
  return fn(parsed, Math.abs(amount));
}

function mixColor(color: string, other: string, ratio: number): string {
  const a = parseHexColor(color);
  const b = parseHexColor(other);
  if (!a || !b) return color;
  const mixed = {
    r: Math.round(a.r * ratio + b.r * (1 - ratio)),
    g: Math.round(a.g * ratio + b.g * (1 - ratio)),
    b: Math.round(a.b * ratio + b.b * (1 - ratio)),
  };
  return toHex(mixed);
}

function alphaColor(color: string, alpha: number): string {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${clamp(alpha, 0, 1).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")})`;
}

function parseHexColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim();
  if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return null;
  if (hex.length === 4) {
    return {
      r: parseInt(hex[1] + hex[1], 16),
      g: parseInt(hex[2] + hex[2], 16),
      b: parseInt(hex[3] + hex[3], 16),
    };
  }
  if (hex.length >= 7) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }
  return null;
}

function lighten(color: { r: number; g: number; b: number }, amount: number): string {
  return toHex({
    r: Math.round(color.r + (255 - color.r) * amount),
    g: Math.round(color.g + (255 - color.g) * amount),
    b: Math.round(color.b + (255 - color.b) * amount),
  });
}

function darken(color: { r: number; g: number; b: number }, amount: number): string {
  return toHex({
    r: Math.round(color.r * (1 - amount)),
    g: Math.round(color.g * (1 - amount)),
    b: Math.round(color.b * (1 - amount)),
  });
}

function toHex(color: { r: number; g: number; b: number }): string {
  return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
