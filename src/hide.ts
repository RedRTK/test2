const UPGRADE_KEY = "upgrade.tooltip.title";

/**
 * Stable selectors only: Spotify's generated class names change with every update, so SpotiKit
 * renames them and they are left out on purpose. These are Spotify's own test ids and readable
 * class names.
 */
const HIDDEN = [
  "#leaderboard-ad-element",
  "#view-billboard-ad",
  '[data-testid="leaderboard-ad-element"]',
  '[data-testid="view-billboard-ad"]',
  '[data-testid="billboard-minimized"]',
  '[data-testid="billboard-image-link"]',
  '[data-testid="hpto-parent-container"]',
  '[data-testid="hpto-native"]',
  '[data-testid="hpto-image"]',
  '[data-testid="hpto-native-buttons"]',
  '[data-testid="html-hpto-container"]',
  '[data-testid="html-hpto-iframe"]',
  '[data-testid="home-ad-card"]',
  '[data-testid="home-ads-container"]',
  '[data-testid^="home-ad-"]',
  '[data-testid="signup-bar"]',
  ".main-leaderboardComponent-container",
  ".main-topBar-UpgradeButton",
  ".sponsor-container",
  '.main-contextMenu-menuItem a[href^="https://www.spotify.com/premium/"]',
  "div:has(> .main-leaderboardComponent-container)",
  'div:has(> [data-testid="home-ad-card"])',
];

function upgradeLabel(): string {
  try {
    const label = SpotiKit.Locale?.t?.(UPGRADE_KEY);
    return typeof label === "string" && label !== UPGRADE_KEY ? label : "";
  } catch {
    return "";
  }
}

function attributeValue(text: string): string {
  return text.replace(/["\\]/g, (character) => `\\${character}`);
}

export function hidingCss(): string {
  const label = upgradeLabel();
  const selectors = [...HIDDEN];
  if (label) {
    const value = attributeValue(label);
    selectors.push(`button[title="${value}"]`, `button[aria-label="${value}"]`);
  }
  return `${selectors.join(",\n")} { display: none !important; }
.main-home-homeHeader { height: 256px !important; }`;
}
