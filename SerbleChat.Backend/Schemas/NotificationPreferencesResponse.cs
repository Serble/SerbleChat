namespace SerbleChat.Backend.Schemas;

public class SetNotificationPreferencesBody {
    public NotificationPreference? Notifications { get; set; }
    public NotificationPreference? Unreads { get; set; }
}
