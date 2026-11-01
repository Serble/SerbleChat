using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

/// <summary>
/// A ntfy topic the user entered by hand. Messages are sent as plaintext, already formatted for display
/// by the ntfy app. Not to be confused with UnifiedPush: a UnifiedPush registration is Web Push
/// encrypted for an app that registered itself, and is stored as a <see cref="UserWebNotificationHook"/>.
/// </summary>
public class UserNtfySubscription {
    [Key]
    public long Id { get; set; }

    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;

    /// <summary>Base URL of the ntfy server, normalised to end with a slash, e.g. https://ntfy.sh/</summary>
    [StringLength(512)]
    public string ServerUrl { get; set; } = null!;

    [StringLength(64)]
    public string Topic { get; set; } = null!;

    /// <summary>ntfy access token (tk_...) or null for anonymous publishing. Never returned by the API.</summary>
    [StringLength(255)]
    public string? AccessToken { get; set; }

    /// <summary>Whether message content is sent. Off by default: unlike Web Push, ntfy messages aren't end-to-end encrypted.</summary>
    public bool IncludeContent { get; set; }

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; }

    public DateTime? LastSuccessAt { get; set; }

    public DateTime? LastFailureAt { get; set; }

    [StringLength(255)]
    public string? LastError { get; set; }

    public int ConsecutiveFailures { get; set; }

    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
}
