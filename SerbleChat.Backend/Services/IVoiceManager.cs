using Livekit.Server.Sdk.Dotnet;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Services;

public interface IVoiceManager {
    public string GetRoomName(long channelId);
    public Task<UsersInVoiceResponse> GetConnectedUsers(long channelId);

    /// <summary>
    /// Records a user's self-reported mute/deafen state and tells everyone who can see the channel.
    /// Ignored (returns false) if the user isn't actually in the channel's voice room.
    /// </summary>
    public Task<bool> UpdateVoiceState(long channelId, string userId, bool muted, bool deafened);

    public Task OnWebhook(WebhookEvent ev);
}
