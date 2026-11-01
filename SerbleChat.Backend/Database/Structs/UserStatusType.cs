namespace SerbleChat.Backend.Database.Structs;

/// <summary>
/// The status a user has picked. "Offline" isn't one of these: it comes from
/// whether they have a live connection (see <see cref="Services.IPresenceService"/>).
/// </summary>
public enum UserStatusType {
    Online = 0,
    Away = 1,
    DoNotDisturb = 2,
    /// <summary>Connected, but shown to everyone else as offline.</summary>
    Invisible = 3
}
