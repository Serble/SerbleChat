using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.SocketHubs;
using StackExchange.Redis;

namespace SerbleChat.Backend.Services.Impl;

public class VoiceManager(IOptions<LiveKitSettings> liveKitSettings, IHubContext<ChatHub> updates, IConnectionMultiplexer redis) : IVoiceManager {
    private RoomServiceClient roomService = new(liveKitSettings.Value.Host, liveKitSettings.Value.Key, liveKitSettings.Value.Secret);
    private string ChannelRoomPrefix => liveKitSettings.Value.RoomPrefix + "channel:";

    // Mute/deafen state lives in a redis hash per channel: field = user ID, value = "{participantSid}|{muted}|{deafened}".
    // The participant SID ties the state to one LiveKit session, so a late participant_left for an
    // old session can't wipe the state of the user's new one, and stale entries are never returned.
    private static RedisKey StateKey(long channelId) => $"voicestate:{channelId}";

    // Safety net for entries whose participant_left/room_finished webhook never arrived
    private static readonly TimeSpan StateExpiry = TimeSpan.FromDays(1);

    // Only delete the user's state if it still belongs to the session that left
    private static readonly LuaScript DeleteIfSessionScript = LuaScript.Prepare("""
        local v = redis.call('HGET', @key, @userId)
        if v and string.sub(v, 1, string.len(@sid) + 1) == @sid .. '|' then
            return redis.call('HDEL', @key, @userId)
        end
        return 0
        """);

    public string GetRoomName(long channelId) {
        return ChannelRoomPrefix + channelId;
    }

    public async Task<UsersInVoiceResponse> GetConnectedUsers(long channelId) {
        ListParticipantsResponse result = await roomService.ListParticipants(
            new ListParticipantsRequest { Room = GetRoomName(channelId) });

        HashEntry[] stored = await redis.GetDatabase().HashGetAllAsync(StateKey(channelId));
        Dictionary<string, string> storedByUser = stored.ToDictionary(e => e.Name.ToString(), e => e.Value.ToString());

        List<VoiceStateResponse> states = result.Participants.Select(p => {
            if (storedByUser.TryGetValue(p.Identity, out string? raw) &&
                TryParseState(raw, out string sid, out bool muted, out bool deafened) && sid == p.Sid) {
                return new VoiceStateResponse { UserId = p.Identity, Muted = muted, Deafened = deafened };
            }

            // Not reported (yet, or by an older client): fall back to what LiveKit knows about the mic
            return new VoiceStateResponse {
                UserId = p.Identity,
                Muted = p.Tracks.Any(t => t.Source == TrackSource.Microphone && t.Muted),
                Deafened = false
            };
        }).ToList();

        return new UsersInVoiceResponse {
            Users = result.Participants.Select(p => p.Identity).ToList(),
            States = states
        };
    }

    public async Task<bool> UpdateVoiceState(long channelId, string userId, bool muted, bool deafened) {
        // Being in the room proves they were allowed to join it, so no separate permission check
        ParticipantInfo participant;
        try {
            participant = await roomService.GetParticipant(new RoomParticipantIdentity {
                Room = GetRoomName(channelId),
                Identity = userId
            });
        }
        catch (Exception) {
            // not in the room (the SDK throws on not found), or LiveKit is unreachable
            return false;
        }

        IDatabase db = redis.GetDatabase();
        await db.HashSetAsync(StateKey(channelId), userId, $"{participant.Sid}|{(muted ? 1 : 0)}|{(deafened ? 1 : 0)}");
        await db.KeyExpireAsync(StateKey(channelId), StateExpiry);

        await updates.Clients.Group($"channel-{channelId}").SendAsync("ClientVoiceStateUpdated", new {
            UserId = userId,
            ChannelId = channelId,
            Muted = muted,
            Deafened = deafened
        });
        return true;
    }

    public async Task OnWebhook(WebhookEvent ev) {
        // a shared LiveKit server sends us events for every app's rooms, ignore ones that aren't ours
        if (!TryGetChannelId(ev.Room?.Name, out long channelId)) {
            return;
        }

        switch (ev.Event) {
            case "participant_joined":
                await JoinLeaveEvent(ev, channelId, "ClientJoinVoice");
                break;

            case "participant_left":
                await DeleteIfSessionScript.EvaluateAsync(redis.GetDatabase(), new {
                    key = StateKey(channelId),
                    userId = ev.Participant.Identity,
                    sid = ev.Participant.Sid
                });
                await JoinLeaveEvent(ev, channelId, "ClientLeaveVoice");
                break;

            case "room_finished":
                await redis.GetDatabase().KeyDeleteAsync(StateKey(channelId));
                break;
        }
    }

    private bool TryGetChannelId(string? roomName, out long channelId) {
        channelId = 0;
        return roomName != null && roomName.StartsWith(ChannelRoomPrefix) &&
               long.TryParse(roomName[ChannelRoomPrefix.Length..], out channelId);
    }

    private static bool TryParseState(string raw, out string sid, out bool muted, out bool deafened) {
        string[] parts = raw.Split('|');
        sid = parts[0];
        muted = parts.Length == 3 && parts[1] == "1";
        deafened = parts.Length == 3 && parts[2] == "1";
        return parts.Length == 3;
    }

    private Task JoinLeaveEvent(WebhookEvent ev, long channelId, string method) {
        return updates.Clients.Group($"channel-{channelId}").SendAsync(method, new {
            UserId = ev.Participant.Identity,
            ChannelId = channelId
        });
    }
}
