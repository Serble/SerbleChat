namespace SerbleChat.Backend.Schemas;

public class UserAccountUpdateRequest {
    public NotificationPreferences? DefaultDmNotificationPreferences { get; set; }
    public NotificationPreferences? DefaultGroupNotificationPreferences { get; set; }
    public NotificationPreferences? DefaultGuildNotificationPreferences { get; set; }
    public bool? NotificationsWhileOnline { get; set; }
}
