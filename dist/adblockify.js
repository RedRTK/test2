// Built by spotikit-kit from src/extension.ts. Edit that file, not this one.

// src/log.ts
var PREFIX = "[Adblockify]";
function info(message) {
  console.info(`${PREFIX} ${message}`);
}
function warn(message) {
  console.warn(`${PREFIX} ${message}`);
}
function fail(message, error) {
  if (error === void 0) console.error(`${PREFIX} ${message}`);
  else console.error(`${PREFIX} ${message}`, error);
}

// src/spotify.ts
var SETTINGS_SERVICES = [
  "spotify.ads.esperanto.settings.proto.Settings",
  "spotify.ads.esperanto.proto.Settings"
];
var SLOTS_SERVICES = [
  "spotify.ads.esperanto.slots.proto.Slots",
  "spotify.ads.esperanto.proto.Slots"
];
var TESTING_SERVICES = [
  "spotify.ads.esperanto.testing.proto.Testing",
  "spotify.ads.esperanto.proto.Testing"
];
var platform = () => SpotiKit.Platform;
function service(name) {
  const services = platform();
  try {
    const direct = services[name];
    if (direct) return direct;
  } catch {
  }
  try {
    return services.get?.(name) ?? void 0;
  } catch {
    return void 0;
  }
}
function productState() {
  const user = service("UserAPI");
  const productStateAPI = service("ProductStateAPI");
  const candidates = [
    user?._product_state,
    user?._product_state_service,
    productStateAPI?.productStateApi,
    productStateAPI
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate;
  }
  return void 0;
}
function adManagers() {
  const managers = service("AdManagers");
  if (managers && Object.keys(managers).length) return managers;
  return void 0;
}
function spotifyVersion() {
  const raw = String(platform().version ?? "");
  return raw.split(".").map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
}
async function waitFor(read, life, timeout = 15e3, interval = 100) {
  const deadline = Date.now() + timeout;
  for (; ; ) {
    const value = read();
    if (value !== void 0) return value;
    if (life.stopped || Date.now() >= deadline) return read();
    await life.wait(interval);
  }
}
function chunkQueue() {
  const globals = window;
  const queue = globals.rspackChunk ?? globals.webpackChunkclient_web ?? globals.rspackChunkclient_web;
  return queue && typeof queue.push === "function" ? queue : void 0;
}
async function loadWebpack(life) {
  const empty = { cache: [], functionModules: [] };
  const queue = await waitFor(chunkQueue, life, 1e4, 50);
  if (!queue) {
    fail("Could not find Spotify's module queue; ads are only hidden in the interface.");
    return empty;
  }
  try {
    const require2 = queue.push([[/* @__PURE__ */ Symbol()], {}, (module) => module]);
    const factories = new Set(Object.values(require2.m ?? {}));
    const cache = Object.keys(require2.m ?? {}).map((id) => require2(id));
    const modules = cache.filter((module) => module && typeof module === "object").flatMap((module) => {
      try {
        return Object.values(module);
      } catch {
        return [];
      }
    });
    const functionModules = modules.flatMap((module) => {
      if (typeof module === "function") return [module];
      if (module && typeof module === "object") {
        return Object.values(module).filter(
          (value) => typeof value === "function" && !factories.has(value)
        );
      }
      return [];
    });
    return { cache, functionModules };
  } catch (error) {
    fail("Could not read Spotify's modules.", error);
    return empty;
  }
}
function serviceClass(modules, ids) {
  return modules.find(
    (module) => ids.includes(module.SERVICE_ID ?? "")
  );
}
function settingsClient(webpack, transport) {
  try {
    const cached = webpack.cache.find((module) => module?.settingsClient)?.settingsClient;
    if (cached) return cached;
    const Client = serviceClass(webpack.functionModules, SETTINGS_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads settings client.", error);
    return null;
  }
}
function slotsClient(webpack, transport) {
  try {
    const Client = serviceClass(webpack.functionModules, SLOTS_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads slots client.", error);
    return null;
  }
}
function testingClient(webpack, transport) {
  try {
    const Client = serviceClass(webpack.functionModules, TESTING_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads testing client.", error);
    return null;
  }
}

// src/features.ts
var OVERRIDES = {
  enableEsperantoMigration: true,
  enableInAppMessaging: false,
  hideUpgradeCTA: true,
  enablePremiumUserForMiniPlayer: true
};
async function applyFeatureOverrides() {
  const api = service("RemoteConfigDebugAPI");
  if (!api || typeof api.setOverride !== "function") {
    info("Spotify's remote config isn't available; feature overrides are skipped.");
    return;
  }
  try {
    if (typeof api.getProperties === "function") {
      const properties = await api.getProperties();
      for (const [name, value] of Object.entries(OVERRIDES)) {
        const ref = properties.find(
          (property) => property?.source === "web" && property?.type === "boolean" && property?.name === name
        );
        if (!ref) continue;
        await api.setOverride({ ref, value }, { autoRunOverrideEffects: ref.localValue !== value });
      }
      return;
    }
    for (const [name, value] of Object.entries(OVERRIDES)) {
      await api.setOverride({ source: "web", type: "boolean", name }, value);
    }
  } catch (error) {
    fail("Could not override Spotify's feature flags.", error);
  }
}

// src/adblock.ts
var READY_TIMEOUT = 15e3;
var POLL = 100;
var RETRY_AFTER = 1e3;
var GIVE_UP_AFTER = 5;
var SLOT_SETTINGS_DELAY = 5e3;
var FEATURES_DELAY = 3e3;
function usesBigIntTimeInterval([major = 0, minor = 0, patch = 0]) {
  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 2) return true;
  if (minor < 2) return false;
  return patch >= 82;
}
function slotIdOf(slot) {
  return slot.slotId || slot.slot_id || "";
}
async function disableManager(manager) {
  if (typeof manager?.disable === "function") await manager.disable();
}
async function disableAdManagers(managers) {
  const { audio, billboard, embeddedAd, inStreamApi, leaderboard, sponsoredPlaylist, vto } = managers;
  await disableManager(audio);
  if (audio) audio.isNewAdsNpvEnabled = false;
  await disableManager(billboard);
  if (typeof leaderboard?.disableLeaderboard === "function") await leaderboard.disableLeaderboard();
  await disableManager(sponsoredPlaylist);
  await disableManager(inStreamApi);
  if (vto) {
    await disableManager(vto.manager);
    vto.isNewAdsNpvEnabled = false;
  }
  await disableManager(embeddedAd?.embeddedAdManager);
}
async function fetchSlots(webpack, state, life) {
  const deadline = Date.now() + READY_TIMEOUT;
  while (!life.stopped && Date.now() < deadline) {
    const client = slotsClient(webpack, state?.transport);
    if (client) {
      try {
        const { adSlots } = await client.getSlots();
        if (adSlots?.length) return adSlots;
      } catch (error) {
        fail("Could not list Spotify's ad slots.", error);
      }
    }
    try {
      const response = await SpotiKit.Http.get("sp://ads/v1/slots");
      if (response?.adSlots?.length) return response.adSlots;
    } catch {
    }
    await life.wait(POLL);
  }
  return [];
}
async function startAdblock(life) {
  const webpack = await loadWebpack(life);
  const state = await waitFor(productState, life, READY_TIMEOUT, POLL);
  const managers = await waitFor(adManagers, life, READY_TIMEOUT, POLL);
  if (!state) warn("Spotify's account state isn't available; ads are only hidden in the interface.");
  if (!managers) warn("Spotify's ad managers aren't available; ads are only hidden in the interface.");
  if (!state && !managers) return;
  const version = spotifyVersion();
  const retries = /* @__PURE__ */ new Map();
  const putOverrides = async () => {
    try {
      await state?.putOverridesValues?.({
        pairs: { ads: "0", catalogue: "premium", product: "premium", type: "premium" }
      });
    } catch (error) {
      fail("Could not mark the account as premium.", error);
    }
  };
  const configure = async () => {
    if (!managers) return;
    try {
      life.timeout(() => void putOverrides(), 100);
      const testing = testingClient(webpack, state?.transport);
      if (testing) await testing.addPlaytime({ seconds: -1e11 });
      else await SpotiKit.Http.post("sp://ads/v1/testing/playtime", { body: { value: -1e11 } }).catch(() => {
      });
      await disableAdManagers(managers);
    } catch (error) {
      fail("Could not turn Spotify's ad managers off.", error);
    }
  };
  const updateSlotSettings = async (slotId) => {
    try {
      const client = settingsClient(webpack, state?.transport);
      if (!client) return;
      const timeInterval = usesBigIntTimeInterval(version) ? 0n : "0";
      await client.updateAdServerEndpoint({ slotIds: [slotId], url: "http://localhost/no/thanks" });
      await client.updateStreamTimeInterval({ slotId, timeInterval });
      await client.updateSlotEnabled({ slotId, enabled: false });
      await client.updateDisplayTimeInterval({ slotId, timeInterval });
    } catch (error) {
      fail(`Could not change the settings of ad slot ${slotId}.`, error);
    }
  };
  const connector = () => managers?.audio?.inStreamApi?.adsCoreConnector ?? managers?.inStreamApi?.adsCoreConnector;
  const clearSlot = async (data) => {
    const slotId = data?.adSlotEvent?.slotId ?? "";
    try {
      connector()?.clearSlot?.(slotId);
      const client = slotsClient(webpack, state?.transport);
      if (client) await client.clearAllAds({ slotId });
      await updateSlotSettings(slotId);
      retries.delete(slotId);
    } catch (error) {
      const attempts = (retries.get(slotId) ?? 0) + 1;
      retries.set(slotId, attempts);
      if (attempts > GIVE_UP_AFTER) {
        retries.delete(slotId);
        fail(`Giving up on ad slot ${slotId}.`, error);
        return;
      }
      fail(`Clearing ad slot ${slotId} failed; retrying.`, error);
      life.timeout(() => void clearSlot(data), RETRY_AFTER);
    }
    await configure();
  };
  const watchSlot = (slotId) => {
    try {
      connector()?.subscribeToSlot?.(slotId, (data) => void clearSlot(data));
    } catch (error) {
      fail(`Could not watch ad slot ${slotId}.`, error);
    }
  };
  const slots = await fetchSlots(webpack, state, life);
  for (const slot of slots) {
    const slotId = slotIdOf(slot);
    if (!slotId) continue;
    watchSlot(slotId);
    life.timeout(() => void clearSlot({ adSlotEvent: { slotId } }), 50);
  }
  void configure();
  try {
    await state?.subValues?.({ keys: ["ads", "catalogue", "product", "type"] }, () => void configure());
  } catch (error) {
    fail("Could not watch Spotify's account values.", error);
  }
  void applyFeatureOverrides();
  life.timeout(() => void applyFeatureOverrides(), FEATURES_DELAY);
  if (slots.length) {
    life.timeout(() => {
      for (const slot of slots) {
        const slotId = slotIdOf(slot);
        if (slotId) void updateSlotSettings(slotId);
      }
    }, SLOT_SETTINGS_DELAY);
  }
  info(slots.length ? `Blocking ads in ${slots.length} slot(s).` : "Blocking ads.");
}

// src/hide.ts
var UPGRADE_KEY = "upgrade.tooltip.title";
var HIDDEN = [
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
  'div:has(> [data-testid="home-ad-card"])'
];
function upgradeLabel() {
  try {
    const label = SpotiKit.Locale?.t?.(UPGRADE_KEY);
    return typeof label === "string" && label !== UPGRADE_KEY ? label : "";
  } catch {
    return "";
  }
}
function attributeValue(text) {
  return text.replace(/["\\]/g, (character) => `\\${character}`);
}
function hidingCss() {
  const label = upgradeLabel();
  const selectors = [...HIDDEN];
  if (label) {
    const value = attributeValue(label);
    selectors.push(`button[title="${value}"]`, `button[aria-label="${value}"]`);
  }
  return `${selectors.join(",\n")} { display: none !important; }
.main-home-homeHeader { height: 256px !important; }`;
}

// src/lifetime.ts
function lifetime() {
  const timeouts = /* @__PURE__ */ new Set();
  const waiting = /* @__PURE__ */ new Set();
  let stopped = false;
  function timeout(callback, ms) {
    if (stopped) return 0;
    const id = window.setTimeout(() => {
      timeouts.delete(id);
      try {
        callback();
      } catch (error) {
        console.error("[Adblockify] A scheduled task failed.", error);
      }
    }, ms);
    timeouts.add(id);
    return id;
  }
  function wait(ms) {
    return new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      const done = () => {
        waiting.delete(done);
        resolve();
      };
      waiting.add(done);
      timeout(done, ms);
    });
  }
  function stop() {
    stopped = true;
    for (const id of timeouts) window.clearTimeout(id);
    timeouts.clear();
    for (const done of waiting) done();
    waiting.clear();
  }
  return {
    get stopped() {
      return stopped;
    },
    timeout,
    wait,
    stop
  };
}

// src/extension.ts
var start = ({ onStop, signal, style }) => {
  const life = lifetime();
  onStop(() => life.stop());
  signal.addEventListener("abort", () => life.stop(), { once: true });
  style(hidingCss());
  void startAdblock(life).catch((error) => fail("Ad blocking stopped unexpectedly.", error));
};
var extension_default = start;
export {
  extension_default as default
};
