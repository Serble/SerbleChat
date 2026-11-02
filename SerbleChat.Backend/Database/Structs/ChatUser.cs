using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using SerbleChat.Backend.Schemas;
using NotificationJsonIgnore = Newtonsoft.Json.JsonIgnoreAttribute;
using ApiJsonIgnore = System.Text.Json.Serialization.JsonIgnoreAttribute;

namespace SerbleChat.Backend.Database.Structs;

// The newtonsoft json annotations are for notifications.
// The System.Text.Json annotations are for the API.
public class ChatUser {
    [Key]
    [StringLength(64)]
    [JsonProperty(PropertyName = "id")]
    public string Id { get; set; } = null!;

    [StringLength(255)]
    [JsonProperty(PropertyName = "username")]
    public string Username { get; set; } = null!;
    
    [JsonProperty(PropertyName = "created_at")]
    public DateTime CreatedAt { get; set; }
    
    [ApiJsonIgnore]
    [NotificationJsonIgnore]
    public string RefreshToken { get; set; } = null!;
    
    // PROFILE
    
    [StringLength(1024)]
    public string Blurb { get; set; } = "";
    
    [StringLength(7)]
    public string Color { get; set; } = "";

    /// <summary>
    /// Changes whenever the profile picture does, so clients can cache <c>pfp/{Id}.webp?v={AvatarVersion}</c> for good.
    /// 0 means there is none. -1 means not known yet: rows from before versions existed, until
    /// <see cref="Services.Impl.ImageVersionBackfill"/> has looked in S3.
    /// </summary>
    [JsonProperty(PropertyName = "avatar_version")]
    public long AvatarVersion { get; set; }
    
    // STATUS
    // Read these through UserStatusExtensions, which applies the expiry.
    // Kept out of message payloads: clients get status from user responses and UserStatusUpdated.
    
    [ApiJsonIgnore]
    [NotificationJsonIgnore]
    public UserStatusType StatusType { get; set; } = UserStatusType.Online;
    
    [ApiJsonIgnore]
    [NotificationJsonIgnore]
    [StringLength(UserStatusExtensions.MaxMessageLength)]
    public string StatusMessage { get; set; } = "";
    
    /// <summary>When the status (type and message) reverts to Online with no message. Null means never.</summary>
    [ApiJsonIgnore]
    [NotificationJsonIgnore]
    public DateTime? StatusExpiresAt { get; set; }
    
    // NOTIFICATIONS
    
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultDmNotificationPreferences { get; set; } = NotificationPreferences.DefaultDmPreferences;
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultGroupNotificationPreferences { get; set; } = NotificationPreferences.DefaultGroupPreferences;
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultGuildNotificationPreferences { get; set; } = NotificationPreferences.DefaultGuildPreferences;
    
    [NotificationJsonIgnore]
    public bool NotificationsWhileOnline { get; set; } = false;
    
    /// <summary>Whether push/ntfy notifications are sent while connected with the Away status.</summary>
    [NotificationJsonIgnore]
    public bool NotificationsWhileAway { get; set; } = true;

    /// <summary>Whether Web Push (browser and, later, UnifiedPush) notifications include the message content.</summary>
    [NotificationJsonIgnore]
    public bool WebPushIncludeContent { get; set; } = true;
    
    // ACCOUNT STATES
    
    [JsonProperty(PropertyName = "is_admin")]
    public bool IsAdmin { get; set; }
    
    [JsonProperty(PropertyName = "is_banned")]
    public bool IsBanned { get; set; }
}
