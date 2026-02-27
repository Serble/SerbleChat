using Livekit.Server.Sdk.Dotnet;

namespace SerbleChat.Backend.Services;

public interface IVoiceManager {
    public Task<List<string>> GetConnectedUsers(long channelId);
    public Task OnWebhook(WebhookEvent ev);
}