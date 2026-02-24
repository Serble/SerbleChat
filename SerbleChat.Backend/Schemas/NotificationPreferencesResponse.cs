namespace SerbleChat.Backend.Schemas;

public class SetNotificationPreferencesBody {
    /// <summary>0=AllMessages, 1=MentionsOnly, 2=Nothing</summary>
    public NotificationPreference? Notifications { get; set; }
    /// <summary>0=AllMessages, 1=MentionsOnly, 2=Nothing</summary>
    public NotificationPreference? Unreads { get; set; }
}
