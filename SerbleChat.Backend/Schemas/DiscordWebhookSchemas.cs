using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Schemas;

/// <summary>Discord's error shape. Libraries read <c>code</c> and <c>message</c>.</summary>
public record DiscordError(
    [property: JsonPropertyName("code")] int Code,
    [property: JsonPropertyName("message")] string Message
) {
    public static readonly DiscordError UnknownWebhook = new(10015, "Unknown Webhook");
    public static readonly DiscordError InvalidToken = new(50027, "Invalid Webhook Token");
    public static readonly DiscordError UnknownChannel = new(10003, "Unknown Channel");
    public static readonly DiscordError EmptyMessage = new(50006, "Cannot send an empty message");
    public static readonly DiscordError InvalidJson = new(50109, "The request body contains invalid JSON.");
}
