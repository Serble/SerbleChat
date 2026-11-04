# Discord Link

A Serble Chat mod that puts you in a Discord voice channel at the same time as a Serble one:

- **Link a Serble voice channel to a Discord one.** Joining that Serble call joins the Discord channel too, and leaving leaves it.
- **Your mic goes to both.** Muting or deafening in Serble mutes or deafens you on Discord too.
- **You hear both.** The Discord people are listed in the voice panel with speaking rings, mute and deafen icons, and a mute button and volume control for each.
- **Link people's accounts.** Link someone's Serble account to their Discord account. While their Serble account is in your Serble call, their Discord audio is muted, so you don't hear them twice.
- **Watch Discord streams.** Press **LIVE** next to someone to watch their Go Live stream in a window you can move, resize and make full screen. Its sound plays too, with its own volume.

Calls are end-to-end encrypted the way Discord requires (DAVE). Hover the Discord heading in the voice panel to see the call's privacy code.

## Installing

1. In Serble Chat (desktop), open **Settings → Mods → Open folder**, and copy this `discord-link` folder into it.
2. In the copied folder, run `npm install`. That fetches `ws`, `htm` and `@snazzah/davey` (DAVE). Davey ships prebuilt N-API binaries, so nothing needs rebuilding for Electron.
3. Back in **Settings → Mods**, press **Reload mods**, turn **Discord Link** on, and press **Reload to apply**.
4. Under Discord Link in the same tab, log in with a Discord token.

While working on the mod, run the app with `SERBLE_MODS_DIR=<repo>/SerbleChat.Frontend/mods` instead of copying it.

### About the token

Logging in with your own account's token makes Serble Chat act as a Discord client for you. **This is against Discord's terms, which count it as a self-bot, and Discord can suspend accounts for it.** A bot token is allowed (switch on "It's a bot token"), but then a bot joins the channel instead of you, and bots probably can't watch streams.

The token is saved in the mod's data folder. It's encrypted with the system keyring when one is available (Electron `safeStorage`), and saved as plain text otherwise. Log out to delete it.

## Using it

1. Join a Serble voice channel. The voice panel shows **Also join a Discord voice channel**. Pick a server and a voice channel, then press **Link**. From then on, joining that Serble channel joins the Discord one.
2. Click a Discord person's name in the voice panel to set their volume, or to link them to someone in the Serble call. You can also link people from a Serble profile card: **Discord → Link Discord account**.
3. **Settings → Mods → Discord Link** lists your links (remove them there). It also sets the mic level that counts as talking. Your mic only goes to Discord above that level, so you don't show as always talking.

## How it works

| Part | Where | What |
|---|---|---|
| `main/gateway.cjs` | Main process | Discord gateway + REST: login, servers, voice channels and who's in them, joining voice, watching streams |
| `main/voice.cjs` | Main process | One voice-server connection (the channel, or a stream): voice gateway v8, UDP, `aead_aes256_gcm_rtpsize`, NACKs and keyframe requests |
| `main/dave.cjs` | Main process | DAVE end-to-end encryption through davey |
| `main/rtp.cjs` | Main process | RTP encryption and parsing, and H264/VP8 frame reassembly (with retransmissions) |
| `main/index.cjs` | Main process | Account, joining and leaving, streams; forwards media to the page |
| `renderer/audio.js` | Page | Serble's processed mic → 20 ms frames → voice activity check → Opus (WebCodecs) → main. Discord Opus → decoded (WebCodecs) → a 60 ms jitter buffer per person → mixed out |
| `renderer/video.js` | Page | Stream frames → WebCodecs `VideoDecoder` → canvas |
| `renderer/index.js` | Page | Keeps Discord in step with the Serble call, applies mutes and volumes, and the UI |

## Limits

- Only server voice channels can be linked. Discord DM and group calls can't.
- You can't send video to Discord (camera or stream), only watch.
- Tested against real Discord: login, joining, DAVE, audio both ways, and watching VP8 streams. H264 streams and cameras have only been tested against a local stand-in server.
- Discord may change its unofficial client protocol at any time.

For testing against a stand-in server, these environment variables replace Discord's addresses: `DISCORD_LINK_GATEWAY`, `DISCORD_LINK_API` and `DISCORD_LINK_VOICE_SCHEME` (`ws` instead of `wss`).
