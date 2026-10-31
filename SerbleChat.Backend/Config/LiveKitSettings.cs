namespace SerbleChat.Backend.Config;

public class LiveKitSettings {
    public string Host { get; set; } = null!;
    public string Key { get; set; } = null!;
    public string Secret { get; set; } = null!;

    // Prepended to every room name so we don't collide with other apps
    // sharing the same LiveKit server.
    public string RoomPrefix { get; set; } = "serblechat:";

    // LiveKit signs webhooks with a single server-wide key (webhook.api_key),
    // which may differ from ours when the server is shared. Falls back to Key/Secret.
    public string? WebhookKey { get; set; }
    public string? WebhookSecret { get; set; }
}
