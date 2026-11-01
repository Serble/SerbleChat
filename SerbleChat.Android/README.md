# Serble Chat for Android

A native Android client: Kotlin and Jetpack Compose, no web view. It talks to the same backend as
the web app (REST plus the `/updates` SignalR hub) and joins calls through LiveKit.

## Building

Needs the Android SDK (platform 37, NDK 27.1 and CMake 3.22 for RNNoise) and JDK 17+.

```sh
./gradlew installDebug     # development backend (gradle.properties: serbleChat.debug*)
./gradlew installPreview   # minified release code against the development backend: judge speed here
./gradlew assembleRelease  # production URLs; signs with SIGNING_* env vars if set, else the debug key
```

Debug builds expect the backend at `http://10.0.2.2:5210` (the host machine, seen from the
emulator) and LiveKit at `ws://10.0.2.2:7880`. Override any URL on the command line, e.g.
`-PserbleChat.debugApiUrl=http://192.168.1.20:5210` for a phone on the same network.

**Sign-in** uses Serble OAuth with the redirect `serblechat://auth/callback`; add it to the
Serble app's redirect URLs. Debug and preview builds can also sign in with a backend test token,
from the "Developer token" box or `adb shell am start -d "serblechat://debug/signin?token=<jwt>"`
(the backend needs `Jwt:AllowTestingAccountGeneration` for `/auth/tokens/{n}`).

**Invite and message links** (`https://chat.serble.net/invite/...`, `/app/channel/...`) open in
the app without asking once the site serves `/.well-known/assetlinks.json`. The frontend build
writes it when `VITE_ANDROID_CERT_FINGERPRINTS` is set to the SHA-256 fingerprint of the release
signing certificate (Play Console's app signing key, if Play re-signs the app). Check it with
`adb shell pm verify-app-links --re-verify net.serble.chat` then `pm get-app-links net.serble.chat`.

## Layout and themes

The main screen is three panels, like Discord's older app: the chat in front, guilds and channels
under it on the left, members on the right. Swipe the chat aside to uncover either one. Back from
the chat slides it aside to the channel list, tracking the back gesture; back from there leaves.
Other pages (settings, friends, the call) slide in over it and follow the back gesture out.

Themes are the web app's: the same five built-ins and the same custom themes, stored in the
account's client options under `theme`, so a theme made or picked on either app shows on both.
Writes merge into that blob rather than replacing it, because it also holds the web's other
settings. Themes export and import in the web's `{ name, colors }` JSON.

## Notifications

Push goes through [UnifiedPush](https://unifiedpush.org). The backend already sends Web Push
(RFC 8030/8291, VAPID-signed), so the app just registers an endpoint with
`POST /account/web-push-subscription` (`kind: "unifiedpush"`) and the connector library decrypts
what arrives.

- If the user has a distributor app (ntfy, Sunup, NextPush...), it's used.
- Otherwise the embedded FCM distributor delivers through Google Play Services. No Firebase
  project or `google-services.json` is needed: FCM accepts the VAPID-signed Web Push directly.
- Without either, Settings says to install a distributor.

While the app is open it holds the hub connection, so the server sends notifications over it
instead (`ReceiveNotification`). When the app goes to the background it closes the connection
cleanly, which the backend takes as "push from now on". During a call it stays connected.

Message notifications are conversation-style, with inline Reply and Mark read. When a channel is
read on another device, the backend sends a silent `{"type":"read"}` push to native subscriptions
only and the app clears that notification.

## Voice and noise suppression

Calls use the LiveKit SDK with a foreground service (`microphone` type), so they carry on with the
screen off. Settings offers three noise suppression modes:

- **RNNoise** (default): the same model the web app uses, compiled from `app/src/main/cpp/rnnoise`
  and run as LiveKit's capture post-processor. Capture is forced to 48 kHz because that's the only
  rate RNNoise works at. It can be switched on and off mid-call.
- **Standard**: WebRTC's own suppression plus the phone's hardware suppressor.
- **Off**.

## Layout

- `data/`: `Api` (REST), `Hub` (a small SignalR JSON-protocol client over OkHttp's WebSocket),
  `ChatStore` (everything the UI shows, as flows, kept up to date by hub events and cached to disk
  so launches open instantly), `Settings`.
- `push/`: UnifiedPush registration, the push service, and notifications.
- `voice/`: the LiveKit call, the RNNoise bridge, and the call service.
- `ui/`: Compose screens.

Not on mobile yet: Serble Files uploads (that system is being reworked), editing roles and channel
permission overrides, webhooks, and video or screen sharing.
