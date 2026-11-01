using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

/// <summary>
/// A URL that posts messages into a channel (Discord-compatible, see <c>WebhookExecuteController</c>).
/// The URL is stable; the channel it posts to can be changed at any time.
/// </summary>
/// <remarks>
/// Webhooks are only created for guilds right now, but nothing about posting depends on that:
/// a future personal webhook could leave <see cref="GuildId"/> null and point at a DM channel.
/// </remarks>
public class Webhook {
    [Key]
    public long Id { get; set; }

    /// <summary>The guild that manages this webhook. Deleting the guild deletes it.</summary>
    [ForeignKey(nameof(GuildNavigation))]
    public long? GuildId { get; set; }

    /// <summary>Where messages go. Null when the channel was deleted and nobody has picked a new one.</summary>
    [ForeignKey(nameof(ChannelNavigation))]
    public long? ChannelId { get; set; }

    [StringLength(WebhookLimits.NameMaxLength)]
    public string Name { get; set; } = null!;

    /// <summary>Secret half of the URL. Stored as-is so it can be shown again, like Discord.</summary>
    [StringLength(64)]
    public string Token { get; set; } = null!;

    /// <summary>Whether <c>webhook-avatars/{Id}.webp</c> exists in S3.</summary>
    public bool HasAvatar { get; set; }

    [ForeignKey(nameof(CreatedByNavigation)), StringLength(64)]
    public string CreatedById { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    // Navigation Properties
    [JsonIgnore]
    public Guild? GuildNavigation { get; set; }
    [JsonIgnore]
    public Channel? ChannelNavigation { get; set; }
    [JsonIgnore]
    public ChatUser CreatedByNavigation { get; set; } = null!;
}

public static class WebhookLimits {
    public const int NameMaxLength = 80;  // same as Discord, so payload usernames fit
    public const int AvatarUrlMaxLength = 2048;
    public const int MaxPerGuild = 50;
}
