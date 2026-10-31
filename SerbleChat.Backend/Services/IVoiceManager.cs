using Livekit.Server.Sdk.Dotnet;

namespace SerbleChat.Backend.Services;

public interface IVoiceManager {
    public string GetRoomName(long channelId);
    public Task<List<string>> GetConnectedUsers(long channelId);
    public Task OnWebhook(WebhookEvent ev);
}