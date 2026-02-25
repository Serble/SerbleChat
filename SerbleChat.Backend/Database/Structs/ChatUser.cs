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
    
    // NOTIFICATIONS
    
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultDmNotificationPreferences { get; set; } = NotificationPreferences.DefaultDmPreferences;
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultGroupNotificationPreferences { get; set; } = NotificationPreferences.DefaultGroupPreferences;
    [NotificationJsonIgnore]
    public NotificationPreferences DefaultGuildNotificationPreferences { get; set; } = NotificationPreferences.DefaultGuildPreferences;
    
    [NotificationJsonIgnore]
    public bool NotificationsWhileOnline { get; set; } = false;
    
    // ACCOUNT STATES
    
    [JsonProperty(PropertyName = "is_admin")]
    public bool IsAdmin { get; set; }
    
    [JsonProperty(PropertyName = "is_banned")]
    public bool IsBanned { get; set; }
}
