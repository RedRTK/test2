# Adblockify

Stream Spotify without interruptions: ads are cleared as they come, and the ones in the
interface are hidden.

## Authors

- **SpotiKit port:** [RedRTK](https://github.com/RedRTK) — this repository.
- **Original adblock for Spicetify:** [ririxi](https://github.com/rxri), from
  [spicetify-extensions/adblock](https://github.com/rxri/spicetify-extensions/tree/main/adblock).
  The idea, the ad services it turns off and part of the CSS are theirs.
- Earlier work on that Spicetify extension: CharlieS1103 (see `LICENSE`).

Ported from that extension to **SpotiKit**: same idea, same ad services, now using SpotiKit's API,
its start/stop lifecycle and its class names.

## Install

Copy the folder into SpotiKit's Extensions folder, or point the Developer page at it while
developing:

| Platform | Path |
| --- | --- |
| Windows | `%APPDATA%\SpotiKit\Extensions\Adblockify` |
| Linux | `~/.config/SpotiKit/Extensions/Adblockify` |

Then turn it on under Marketplace → **Installed**. SpotiKit loads `dist/adblockify.js`, and the
extension starts and stops without restarting Spotify.

## Build

```sh
npm install
npm run build     # dist/adblockify.js
npm run check     # manifest, files, code and types
```

`dist/` is committed on purpose: SpotiKit and the Marketplace only load `main`.

## What it does

- Hides ad and upsell elements in the interface: leaderboards, billboards, home ad cards,
  signup bars, the upgrade button and premium links in the menus.
- Turns Spotify's ad managers off: in-stream audio and video, billboards, leaderboards,
  sponsored playlists and VTO.
- Clears every ad slot it finds as Spotify fires it, and points the slot's ad server at a dead
  endpoint.
- Reports the account as premium in Spotify's own account state, and turns the upsell feature
  flags off through Spotify's remote config.

## What changed in the port

| Spicetify | SpotiKit |
| --- | --- |
| `Spicetify.Platform` | `SpotiKit.Platform` (plus `Platform.get(name)` for services that aren't listed) |
| `Spicetify.CosmosAsync` | `SpotiKit.Http` (`sp://` goes through Spotify's own request service) |
| `Spicetify.Locale.get` | `SpotiKit.Locale.t` |
| `Spicetify.Events.platformLoaded` / `webpackLoaded` | extensions start after `SpotiKit.ready`; the module queue is polled |
| IIFE that runs forever | `export default` start function; timers and listeners are dropped on stop |
| Spotify's generated class names | stable test ids and readable class names, because SpotiKit renames the generated ones |
| `spicetify-exp-features` in localStorage | Spotify's own `RemoteConfigDebugAPI` overrides only, since that Spicetify key doesn't exist here |

The internals it relies on are Spotify's, not SpotiKit's: the ads protobuf clients are built from
Spotify's loaded modules, exactly like before. If an update moves something, the log says which
part is missing and the rest keeps working.

## Credits

This is a port, not an original work. The ad services it disables, the approach of reporting the
account as premium and the CSS that hides the ad elements come from ririxi's Spicetify extension,
which in turn builds on CharlieS1103's work. What is new here is the SpotiKit side: the extension
API, the start/stop lifecycle, the timer cleanup and the move from generated class names to stable
test ids.

## Not tested here

This was built and type-checked without Spotify (the development machines here run Linux and have
no Spotify client), so the blocking itself was not run against a live client.
