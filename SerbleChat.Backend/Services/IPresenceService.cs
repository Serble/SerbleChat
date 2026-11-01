using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

/// <summary>
/// Tracks who has a live connection and tells people when someone's visible status changes.
/// </summary>
/// <remarks>
/// "Connected" is the raw fact that a client is heartbeating. It is true for Invisible users too,
/// so use it for notification decisions but never hand it to other users directly: go through
/// <see cref="Schemas.UserStatusExtensions.PublicPresence"/>.
/// </remarks>
public interface IPresenceService {
    Task<bool> IsConnected(string userId);
    Task<HashSet<string>> GetConnected(IEnumerable<string> userIds);

    /// <summary>Called on connect and on every client heartbeat. Broadcasts when the user comes online.</summary>
    Task Heartbeat(string userId, string connectionId);

    /// <summary>Called when a connection closes. Broadcasts when it was the user's last one.</summary>
    Task Disconnected(string userId, string connectionId);

    /// <summary>
    /// Sends the user's current status to everyone who shares a guild, DM or group with them
    /// (<c>UserStatusUpdated</c>), and their real status to their own clients (<c>OwnStatusUpdated</c>).
    /// </summary>
    Task BroadcastStatus(ChatUser user);
}
