using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class ChatUser {
    [Key]
    [StringLength(64)]
    public string Id { get; set; } = null!;

    [StringLength(255)]
    public string Username { get; set; } = null!;
    
    public DateTime CreatedAt { get; set; }
    
    [JsonIgnore]
    public string RefreshToken { get; set; } = null!;
    
    public NotificationPreferences DefaultDmNotificationPreferences { get; set; } = NotificationPreferences.DefaultDmPreferences;
    public NotificationPreferences DefaultGroupNotificationPreferences { get; set; } = NotificationPreferences.DefaultGroupPreferences;
    public NotificationPreferences DefaultGuildNotificationPreferences { get; set; } = NotificationPreferences.DefaultGuildPreferences;
    
    public bool IsAdmin { get; set; }
    
    public bool IsBanned { get; set; }
}
