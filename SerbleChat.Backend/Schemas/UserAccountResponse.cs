using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

public record UserAccountResponse(
    string Id, string Username, bool IsAdmin, bool IsBanned, DateTime CreatedAt,
    NotificationPreferences DefaultDmNotificationPreferences,
    NotificationPreferences DefaultGroupNotificationPreferences,
    NotificationPreferences DefaultGuildNotificationPreferences,
    bool NotificationsWhileOnline,
    bool NotificationsWhileAway,
    bool WebPushIncludeContent,
    string Blurb,
    string Color,
    string StatusType,
    string StatusMessage,
    DateTime? StatusExpiresAt,
    long AvatarVersion)
{
    public static UserAccountResponse FromChatUser(ChatUser user) {
        return new UserAccountResponse(
            user.Id, user.Username, user.IsAdmin, user.IsBanned, user.CreatedAt,
            user.DefaultDmNotificationPreferences,
            user.DefaultGroupNotificationPreferences,
            user.DefaultGuildNotificationPreferences,
            user.NotificationsWhileOnline,
            user.NotificationsWhileAway,
            user.WebPushIncludeContent,
            user.Blurb,
            user.Color,
            user.EffectiveStatusType().ToName(),
            user.EffectiveStatusMessage(),
            user.EffectiveStatusExpiresAt(),
            user.AvatarVersion);
    }
}

/// <param name="IsOnline">Whether <paramref name="Status"/> is anything but offline. Kept for older clients.</param>
/// <param name="Status">online, away, dnd or offline. Invisible users are reported as offline.</param>
/// <param name="AvatarVersion">See <see cref="ChatUser.AvatarVersion"/>.</param>
public record PublicUserResponse(
    string Id, string Username, bool IsAdmin, bool IsBanned, DateTime CreatedAt, bool IsOnline,
    string Blurb, string Color,
    string Status, string StatusMessage, DateTime? StatusExpiresAt, long AvatarVersion)
{
    /// <param name="connected">Whether the user has a live connection, from <see cref="Services.IPresenceService"/>.</param>
    public static PublicUserResponse FromChatUser(ChatUser user, bool connected) {
        string status = user.PublicPresence(connected);
        return new PublicUserResponse(user.Id, user.Username, user.IsAdmin, user.IsBanned, user.CreatedAt,
            status != UserStatusNames.Offline, user.Blurb, user.Color,
            status, user.EffectiveStatusMessage(), user.EffectiveStatusExpiresAt(), user.AvatarVersion);
    }
}
