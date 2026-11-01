using System.Text;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

/// <summary>
/// Status values as the API spells them. A user's stored type is one of
/// online/away/dnd/invisible; what other people see is online/away/dnd/offline.
/// </summary>
public static class UserStatusNames {
    public const string Online = "online";
    public const string Away = "away";
    public const string DoNotDisturb = "dnd";
    public const string Invisible = "invisible";
    public const string Offline = "offline";

    public static string ToName(this UserStatusType type) => type switch {
        UserStatusType.Online => Online,
        UserStatusType.Away => Away,
        UserStatusType.DoNotDisturb => DoNotDisturb,
        UserStatusType.Invisible => Invisible,
        _ => throw new ArgumentOutOfRangeException(nameof(type))
    };

    public static bool TryParse(string? name, out UserStatusType type) {
        switch (name) {
            case Online: type = UserStatusType.Online; return true;
            case Away: type = UserStatusType.Away; return true;
            case DoNotDisturb: type = UserStatusType.DoNotDisturb; return true;
            case Invisible: type = UserStatusType.Invisible; return true;
            default: type = default; return false;
        }
    }
}

public static class UserStatusExtensions {
    public const int MaxMessageLength = 128;

    /// <summary>True once the status's expiry has passed. Expired statuses read as Online with no message.</summary>
    public static bool StatusExpired(this ChatUser user) =>
        user.StatusExpiresAt.HasValue && user.StatusExpiresAt.Value <= DateTime.UtcNow;

    public static UserStatusType EffectiveStatusType(this ChatUser user) =>
        user.StatusExpired() ? UserStatusType.Online : user.StatusType;

    public static string EffectiveStatusMessage(this ChatUser user) =>
        user.StatusExpired() ? "" : user.StatusMessage;

    /// <summary>The expiry of a status that's still active, marked as UTC so it serialises with a Z.</summary>
    public static DateTime? EffectiveStatusExpiresAt(this ChatUser user) =>
        user.StatusExpired() || !user.StatusExpiresAt.HasValue
            ? null
            : DateTime.SpecifyKind(user.StatusExpiresAt.Value, DateTimeKind.Utc);

    /// <summary>
    /// What other people see: offline unless connected, and Invisible always shows as offline.
    /// </summary>
    public static string PublicPresence(this ChatUser user, bool connected) {
        if (!connected) return UserStatusNames.Offline;
        UserStatusType type = user.EffectiveStatusType();
        return type == UserStatusType.Invisible ? UserStatusNames.Offline : type.ToName();
    }

    /// <summary>Resets the stored status to the default (Online, no message, no expiry).</summary>
    public static void ClearStatus(this ChatUser user) {
        user.StatusType = UserStatusType.Online;
        user.StatusMessage = "";
        user.StatusExpiresAt = null;
    }

    /// <summary>
    /// Trims the message, turns line breaks and other control characters into spaces,
    /// and collapses runs of whitespace, so it always renders as one line.
    /// </summary>
    public static string NormaliseStatusMessage(string? message) {
        if (string.IsNullOrWhiteSpace(message)) return "";
        StringBuilder sb = new(message.Length);
        bool lastWasSpace = false;
        foreach (char c in message) {
            bool space = char.IsWhiteSpace(c) || char.IsControl(c);
            if (space) {
                if (!lastWasSpace) sb.Append(' ');
                lastWasSpace = true;
            }
            else {
                sb.Append(c);
                lastWasSpace = false;
            }
        }
        return sb.ToString().Trim();
    }
}

/// <summary>Sent to everyone who can see the user, as <c>UserStatusUpdated</c>.</summary>
public record UserStatusUpdate(string UserId, string Status, string StatusMessage, DateTime? StatusExpiresAt) {
    public static UserStatusUpdate From(ChatUser user, bool connected) =>
        new(user.Id, user.PublicPresence(connected), user.EffectiveStatusMessage(), user.EffectiveStatusExpiresAt());
}

/// <summary>Sent to the user's own clients, as <c>OwnStatusUpdated</c>, so every tab shows the real type.</summary>
public record OwnStatusUpdate(string StatusType, string StatusMessage, DateTime? StatusExpiresAt) {
    public static OwnStatusUpdate From(ChatUser user) =>
        new(user.EffectiveStatusType().ToName(), user.EffectiveStatusMessage(), user.EffectiveStatusExpiresAt());
}

public class SetStatusRequest {
    /// <summary>online, away, dnd or invisible.</summary>
    public string Type { get; set; } = UserStatusNames.Online;
    public string? Message { get; set; }
    /// <summary>When the status reverts to Online with no message. Null or omitted means never.</summary>
    public DateTime? ExpiresAt { get; set; }
}
