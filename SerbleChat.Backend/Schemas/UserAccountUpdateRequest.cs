using System.ComponentModel.DataAnnotations;

namespace SerbleChat.Backend.Schemas;

public class UserAccountUpdateRequest {
    public NotificationPreferences? DefaultDmNotificationPreferences { get; set; }
    public NotificationPreferences? DefaultGroupNotificationPreferences { get; set; }
    public NotificationPreferences? DefaultGuildNotificationPreferences { get; set; }
    public bool? NotificationsWhileOnline { get; set; }
    [MaxLength(1024)]
    public string? Blurb { get; set; }
    [MaxLength(7)]
    public string? Color { get; set; }
}
