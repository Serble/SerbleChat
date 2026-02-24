using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class UserGuildNotificationPreferences {
    [Key]
    public int Id { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(GuildNavigation))]
    public int GuildId { get; set; }

    public NotificationPreferences Preferences { get; set; } = NotificationPreferences.DefaultPreferences;
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    public Channel GuildNavigation { get; set; } = null!;
}
