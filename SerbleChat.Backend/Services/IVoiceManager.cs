using Livekit.Server.Sdk.Dotnet;

namespace SerbleChat.Backend.Services;

public interface IVoiceManager {
    public Task<List<string>> GetConnectedUsers(int channelId);
    public Task OnWebhook(WebhookEvent ev);
}