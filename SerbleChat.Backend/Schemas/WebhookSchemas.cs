using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

public class WebhookCreateRequest {
    public string Name { get; set; } = null!;
    public long ChannelId { get; set; }
}

/// <summary>Fields left null are unchanged.</summary>
public class WebhookUpdateRequest {
    public string? Name { get; set; }
    public long? ChannelId { get; set; }
}

/// <summary>A webhook as shown to people who manage it, token included so the URL can be copied.</summary>
public record WebhookResponse(
    long Id,
    long? GuildId,
    long? ChannelId,
    string Name,
    string Token,
    bool HasAvatar,
    string CreatedById,
    DateTime CreatedAt
) {
    public static WebhookResponse FromWebhook(Webhook w) =>
        new(w.Id, w.GuildId, w.ChannelId, w.Name, w.Token, w.HasAvatar, w.CreatedById, w.CreatedAt);
}
