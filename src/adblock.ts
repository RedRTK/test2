import { applyFeatureOverrides } from "./features";
import type { Lifetime } from "./lifetime";
import { fail, info, warn } from "./log";
import {
  adManagers,
  loadWebpack,
  productState,
  settingsClient,
  slotsClient,
  spotifyVersion,
  testingClient,
  waitFor,
  type AdManagers,
  type AdSlot,
  type ProductStateAPI,
  type SlotEvent,
  type WebpackCache,
} from "./spotify";

const READY_TIMEOUT = 15_000;
const POLL = 100;
const RETRY_AFTER = 1_000;
const GIVE_UP_AFTER = 5;
const SLOT_SETTINGS_DELAY = 5_000;
const FEATURES_DELAY = 3_000;

function usesBigIntTimeInterval([major = 0, minor = 0, patch = 0]: number[]): boolean {
  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 2) return true;
  if (minor < 2) return false;
  return patch >= 82;
}

function slotIdOf(slot: AdSlot): string {
  return slot.slotId || slot.slot_id || "";
}

async function disableManager(manager?: { disable?(): void | Promise<void> }): Promise<void> {
  if (typeof manager?.disable === "function") await manager.disable();
}

async function disableAdManagers(managers: AdManagers): Promise<void> {
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

/** Spotify only hands out its ad slots once the ads service is up, so this retries. */
async function fetchSlots(
  webpack: WebpackCache,
  state: ProductStateAPI | undefined,
  life: Lifetime,
): Promise<AdSlot[]> {
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
      const response = await SpotiKit.Http.get<{ adSlots?: AdSlot[] }>("sp://ads/v1/slots");
      if (response?.adSlots?.length) return response.adSlots;
    } catch {
      // The endpoint answers only while the ads service is up; try again below.
    }
    await life.wait(POLL);
  }
  return [];
}

export async function startAdblock(life: Lifetime): Promise<void> {
  const webpack = await loadWebpack(life);
  const state = await waitFor(productState, life, READY_TIMEOUT, POLL);
  const managers = await waitFor(adManagers, life, READY_TIMEOUT, POLL);
  if (!state) warn("Spotify's account state isn't available; ads are only hidden in the interface.");
  if (!managers) warn("Spotify's ad managers aren't available; ads are only hidden in the interface.");
  if (!state && !managers) return;

  const version = spotifyVersion();
  const retries = new Map<string, number>();

  const putOverrides = async (): Promise<void> => {
    try {
      await state?.putOverridesValues?.({
        pairs: { ads: "0", catalogue: "premium", product: "premium", type: "premium" },
      });
    } catch (error) {
      fail("Could not mark the account as premium.", error);
    }
  };

  const configure = async (): Promise<void> => {
    if (!managers) return;
    try {
      life.timeout(() => void putOverrides(), 100);
      const testing = testingClient(webpack, state?.transport);
      if (testing) await testing.addPlaytime({ seconds: -100000000000 });
      else await SpotiKit.Http.post("sp://ads/v1/testing/playtime", { body: { value: -100000000000 } }).catch(() => {});
      await disableAdManagers(managers);
    } catch (error) {
      fail("Could not turn Spotify's ad managers off.", error);
    }
  };

  const updateSlotSettings = async (slotId: string): Promise<void> => {
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

  const clearSlot = async (data: SlotEvent): Promise<void> => {
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

  const watchSlot = (slotId: string): void => {
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
