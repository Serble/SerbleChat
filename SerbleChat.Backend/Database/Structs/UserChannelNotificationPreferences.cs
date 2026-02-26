using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Structs;

public class UserChannelNotificationPreferences {
    [Key]
    public long Id { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(ChannelNavigation))]
    public long ChannelId { get; set; }

    public NotificationPreferences Preferences { get; set; } = NotificationPreferences.DefaultPreferences;
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    public Channel ChannelNavigation { get; set; } = null!;
}
