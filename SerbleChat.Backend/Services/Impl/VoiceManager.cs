using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.SocketHubs;

namespace SerbleChat.Backend.Services.Impl;

public class VoiceManager(IOptions<LiveKitSettings> liveKitSettings, IHubContext<ChatHub> updates) : IVoiceManager {
    private RoomServiceClient roomService = new(liveKitSettings.Value.Host, liveKitSettings.Value.Key, liveKitSettings.Value.Secret);
    private string ChannelRoomPrefix => liveKitSettings.Value.RoomPrefix + "channel:";

    public string GetRoomName(long channelId) {
        return ChannelRoomPrefix + channelId;
    }

    public async Task<List<string>> GetConnectedUsers(long channelId) {
        ListParticipantsResponse result = await roomService.ListParticipants(
            new ListParticipantsRequest { Room = GetRoomName(channelId) });

        return result.Participants.Select(p => p.Identity).ToList();
    }

    public async Task OnWebhook(WebhookEvent ev) {
        switch (ev.Event) {
            case "participant_joined":
                await JoinLeaveEvent(ev, "ClientJoinVoice");
                break;

            case "participant_left":
                await JoinLeaveEvent(ev, "ClientLeaveVoice");
                break;
        }
    }

    private Task JoinLeaveEvent(WebhookEvent ev, string method) {
        string userId = ev.Participant.Identity;
        string? roomName = ev.Room?.Name;

        // a shared LiveKit server sends us events for every app's rooms, ignore ones that aren't ours
        if (roomName == null || !roomName.StartsWith(ChannelRoomPrefix) ||
            !long.TryParse(roomName[ChannelRoomPrefix.Length..], out long channelId)) {
            return Task.CompletedTask;
        }

        return updates.Clients.Group($"channel-{channelId}").SendAsync(method, new {
            UserId = userId,
            ChannelId = channelId
        });
    }
}
