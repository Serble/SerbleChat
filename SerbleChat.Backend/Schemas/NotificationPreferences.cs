using System.Diagnostics.Contracts;
using Microsoft.EntityFrameworkCore;

namespace SerbleChat.Backend.Schemas;

[Owned]
public class NotificationPreferences {
    /// <summary>
    /// What the user will receive push notifications for.
    /// </summary>
    public NotificationPreference Notifications { get; set; } = NotificationPreference.Inherit;

    /// <summary>
    /// What the user will see unreads in the channel for.
    /// </summary>
    public NotificationPreference Unreads { get; set; } = NotificationPreference.Inherit;
    
    public static NotificationPreferences DefaultDmPreferences => new() {
        Notifications = NotificationPreference.AllMessages,
        Unreads = NotificationPreference.AllMessages
    };
    
    public static NotificationPreferences DefaultGroupPreferences => new() {
        Notifications = NotificationPreference.MentionsOnly,
        Unreads = NotificationPreference.AllMessages
    };
    
    public static NotificationPreferences DefaultGuildPreferences => new() {
        Notifications = NotificationPreference.MentionsOnly,
        Unreads = NotificationPreference.AllMessages
    };
    
    public static NotificationPreferences DefaultPreferences => new() {
        Notifications = NotificationPreference.Inherit,
        Unreads = NotificationPreference.Inherit
    };
    
    [Pure]
    public NotificationPreferences ApplyOverride(NotificationPreferences? parent) {
        if (parent == null) return this;
        
        return new NotificationPreferences {
            Notifications = Notifications == NotificationPreference.Inherit ? parent.Notifications : Notifications,
            Unreads = Unreads == NotificationPreference.Inherit ? parent.Unreads : Unreads
        };
    }
}

public enum NotificationPreference {
    Inherit,
    AllMessages,
    MentionsOnly,
    Nothing
}

