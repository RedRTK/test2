import type { Lifetime } from "./lifetime";
import { fail } from "./log";

export type AnyFunction = (...args: any[]) => any;

/** Spotify's account state: what plans the client thinks you are on. */
export interface ProductStateAPI {
  putOverridesValues?(params: { pairs: Record<string, string> }): Promise<void>;
  subValues?(params: { keys: string[] }, callback: () => void): Promise<unknown>;
  transport?: any;
}

export interface SlotEvent {
  adSlotEvent?: { slotId?: string };
}

export interface AdSlot {
  slotId?: string;
  slot_id?: string;
}

export interface AdConnector {
  clearSlot?(slotId: string): void;
  subscribeToSlot?(slotId: string, callback: (data: SlotEvent) => void): void;
}

export interface AdStreamAPI {
  disable?(): void | Promise<void>;
  adsCoreConnector?: AdConnector;
}

export interface AdManagers {
  audio?: AdStreamAPI & { inStreamApi?: AdStreamAPI; isNewAdsNpvEnabled?: boolean };
  billboard?: { disable?(): void | Promise<void> };
  embeddedAd?: { embeddedAdManager?: { disable?(): void | Promise<void> } };
  leaderboard?: { disableLeaderboard?(): void | Promise<void> };
  inStreamApi?: AdStreamAPI;
  sponsoredPlaylist?: { disable?(): void | Promise<void> };
  vto?: {
    manager?: { disable?(): void | Promise<void> };
    isNewAdsNpvEnabled?: boolean;
  };
}

export interface SettingsClient {
  updateAdServerEndpoint(params: { slotIds: string[]; url: string }): Promise<void>;
  updateDisplayTimeInterval(params: { slotId: string; timeInterval: bigint | string }): Promise<void>;
  updateSlotEnabled(params: { slotId: string; enabled: boolean }): Promise<void>;
  updateStreamTimeInterval(params: { slotId: string; timeInterval: bigint | string }): Promise<void>;
}

export interface SlotsClient {
  clearAllAds(params: { slotId: string }): Promise<void>;
  getSlots(): Promise<{ adSlots?: AdSlot[] }>;
}

export interface TestingClient {
  addPlaytime(params: { seconds: number }): void | Promise<void>;
}

export interface WebpackCache {
  cache: any[];
  functionModules: AnyFunction[];
}

const SETTINGS_SERVICES = [
  "spotify.ads.esperanto.settings.proto.Settings",
  "spotify.ads.esperanto.proto.Settings",
];
const SLOTS_SERVICES = [
  "spotify.ads.esperanto.slots.proto.Slots",
  "spotify.ads.esperanto.proto.Slots",
];
const TESTING_SERVICES = [
  "spotify.ads.esperanto.testing.proto.Testing",
  "spotify.ads.esperanto.proto.Testing",
];

const platform = (): Record<string, any> => SpotiKit.Platform as Record<string, any>;

/** A service from SpotiKit.Platform, listed or not. */
export function service<T>(name: string): T | undefined {
  const services = platform();
  try {
    const direct = services[name];
    if (direct) return direct as T;
  } catch {
    // Some of Spotify's services throw while the client is still starting.
  }
  try {
    return (services.get?.(name) as T) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Spotify's account state, wherever this version keeps it. */
export function productState(): ProductStateAPI | undefined {
  const user = service<Record<string, any>>("UserAPI");
  const productStateAPI = service<Record<string, any>>("ProductStateAPI");
  const candidates = [
    user?._product_state,
    user?._product_state_service,
    productStateAPI?.productStateApi,
    productStateAPI,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate as ProductStateAPI;
  }
  return undefined;
}

export function adManagers(): AdManagers | undefined {
  const managers = service<AdManagers>("AdManagers");
  if (managers && Object.keys(managers).length) return managers;
  return undefined;
}

export function spotifyVersion(): number[] {
  const raw = String(platform().version ?? "");
  return raw
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

/** Polls until read() gives something, the timeout passes or the extension stops. */
export async function waitFor<T>(
  read: () => T | undefined,
  life: Lifetime,
  timeout = 15_000,
  interval = 100,
): Promise<T | undefined> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (life.stopped || Date.now() >= deadline) return read();
    await life.wait(interval);
  }
}

type ChunkQueue = { push(chunk: unknown[]): any };

function chunkQueue(): ChunkQueue | undefined {
  const globals = window as unknown as Record<string, unknown>;
  const queue = globals.rspackChunk ?? globals.webpackChunkclient_web ?? globals.rspackChunkclient_web;
  return queue && typeof (queue as ChunkQueue).push === "function" ? (queue as ChunkQueue) : undefined;
}

/**
 * Spotify's loaded modules, read through its own module queue. The ads services in there are
 * protobuf clients that only exist inside the client, so they are built here with the tiny
 * constructor Spotify itself uses.
 */
export async function loadWebpack(life: Lifetime): Promise<WebpackCache> {
  const empty: WebpackCache = { cache: [], functionModules: [] };
  const queue = await waitFor(chunkQueue, life, 10_000, 50);
  if (!queue) {
    fail("Could not find Spotify's module queue; ads are only hidden in the interface.");
    return empty;
  }
  try {
    const require = queue.push([[Symbol()], {}, (module: unknown) => module]) as any;
    const factories = new Set(Object.values(require.m ?? {}));
    const cache: any[] = Object.keys(require.m ?? {}).map((id) => require(id));
    const modules = cache
      .filter((module) => module && typeof module === "object")
      .flatMap((module) => {
        try {
          return Object.values(module);
        } catch {
          return [];
        }
      });
    const functionModules = modules.flatMap((module): AnyFunction[] => {
      if (typeof module === "function") return [module as AnyFunction];
      if (module && typeof module === "object") {
        return Object.values(module).filter(
          (value): value is AnyFunction => typeof value === "function" && !factories.has(value),
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

function serviceClass<T>(modules: AnyFunction[], ids: string[]): (new (transport: any) => T) | undefined {
  return modules.find((module) =>
    ids.includes((module as unknown as { SERVICE_ID?: string }).SERVICE_ID ?? ""),
  ) as unknown as (new (transport: any) => T) | undefined;
}

export function settingsClient(webpack: WebpackCache, transport: any): SettingsClient | null {
  try {
    const cached = webpack.cache.find((module) => module?.settingsClient)?.settingsClient;
    if (cached) return cached as SettingsClient;
    const Client = serviceClass<SettingsClient>(webpack.functionModules, SETTINGS_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads settings client.", error);
    return null;
  }
}

export function slotsClient(webpack: WebpackCache, transport: any): SlotsClient | null {
  try {
    const Client = serviceClass<SlotsClient>(webpack.functionModules, SLOTS_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads slots client.", error);
    return null;
  }
}

export function testingClient(webpack: WebpackCache, transport: any): TestingClient | null {
  try {
    const Client = serviceClass<TestingClient>(webpack.functionModules, TESTING_SERVICES);
    return Client ? new Client(transport) : null;
  } catch (error) {
    fail("Could not create Spotify's ads testing client.", error);
    return null;
  }
}
