import { fail, info } from "./log";
import { service } from "./spotify";

const OVERRIDES = {
  enableEsperantoMigration: true,
  enableInAppMessaging: false,
  hideUpgradeCTA: true,
  enablePremiumUserForMiniPlayer: true,
} as const;

interface RemoteConfigProperty {
  source?: string;
  type?: string;
  name?: string;
  localValue?: boolean;
}

interface RemoteConfigDebugAPI {
  getProperties?(): Promise<RemoteConfigProperty[]>;
  setOverride(...params: any[]): Promise<void> | void;
}

/** Spotify's own feature flags, set the way its debug menu sets them. */
export async function applyFeatureOverrides(): Promise<void> {
  const api = service<RemoteConfigDebugAPI>("RemoteConfigDebugAPI");
  if (!api || typeof api.setOverride !== "function") {
    info("Spotify's remote config isn't available; feature overrides are skipped.");
    return;
  }
  try {
    if (typeof api.getProperties === "function") {
      const properties = await api.getProperties();
      for (const [name, value] of Object.entries(OVERRIDES)) {
        const ref = properties.find(
          (property) => property?.source === "web" && property?.type === "boolean" && property?.name === name,
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
