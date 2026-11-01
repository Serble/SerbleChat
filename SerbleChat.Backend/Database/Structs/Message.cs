using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Newtonsoft.Json;
using SerbleChat.Backend.Schemas;
using NotificationJsonIgnore = Newtonsoft.Json.JsonIgnoreAttribute;
using ApiJsonIgnore = System.Text.Json.Serialization.JsonIgnoreAttribute;

namespace SerbleChat.Backend.Database.Structs;

// The newtonsoft json annotations are for notifications.
// The System.Text.Json annotations are for the API.
public class Message {
    [Key]
    [JsonProperty(PropertyName = "id")]
    public long Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    [JsonProperty(PropertyName = "channel_id")]
    public long ChannelId { get; set; }
    
    [JsonProperty(PropertyName = "created_at")]
    public DateTime CreatedAt { get; set; }
    
    /// <summary>The user who sent it, or null when it came from a webhook.</summary>
    [ForeignKey(nameof(AuthorNavigation)), StringLength(64)]
    [JsonProperty(PropertyName = "author_id")]
    public string? AuthorId { get; set; }

    /// <summary>The webhook that sent it. Null for user messages, and once the webhook is deleted.</summary>
    [ForeignKey(nameof(WebhookNavigation))]
    [JsonProperty(PropertyName = "webhook_id")]
    public long? WebhookId { get; set; }

    /// <summary>Name shown for a webhook message, copied when it was sent so renames don't rewrite history.</summary>
    [StringLength(WebhookLimits.NameMaxLength)]
    [JsonProperty(PropertyName = "webhook_username")]
    public string? WebhookUsername { get; set; }

    /// <summary>Avatar the webhook request asked for. Null means use the webhook's own avatar.</summary>
    [StringLength(WebhookLimits.AvatarUrlMaxLength)]
    [JsonProperty(PropertyName = "webhook_avatar_url")]
    public string? WebhookAvatarUrl { get; set; }
    
    [StringLength(16384)]
    [JsonProperty(PropertyName = "content")]
    public string Content { get; set; } = null!;

    [JsonProperty(PropertyName = "edited_at")]
    public DateTime? EditedAt { get; set; }

    /// <summary>The poll attached to this message, if any. Filled in by the poll repo, not stored here.</summary>
    [NotMapped]
    [NotificationJsonIgnore]
    public PollResponse? Poll { get; set; }
    
    // Navigation Properties
    [ApiJsonIgnore]
    [JsonProperty(PropertyName = "author")]
    public ChatUser? AuthorNavigation { get; set; }
    [ApiJsonIgnore]
    [NotificationJsonIgnore]
    public Webhook? WebhookNavigation { get; set; }
    [ApiJsonIgnore]
    [JsonProperty(PropertyName = "channel")]
    public Channel ChannelNavigation { get; set; } = null!;
}

public static class MessageLimits {
    public const int ContentMaxLength = 16384;
}
