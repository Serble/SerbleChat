using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Lib.Net.Http.WebPush;

namespace SerbleChat.Backend.Database.Structs;

public class UserWebNotificationHook {
    [Key]
    public long Id { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [StringLength(1024)]  // some URLs can be long, 1024 should be decent enough
    public string Url { get; set; } = null!;

    /// <summary>SHA-256 of <see cref="Url"/>, lowercase hex. Unique: the URL itself is too long for a MySQL index.</summary>
    [StringLength(64)]
    public string UrlHash { get; set; } = null!;
    
    [StringLength(128)]  // p256dh keys are 87 characters long, but we add some extra padding just in case
    public string P256dh { get; set; } = null!;
    
    [StringLength(64)]  // auth keys are usually around 22, but better safe than sorry
    public string Auth { get; set; } = null!;
    
    [StringLength(255)]  // not super important to store all of this
    public string UserAgent { get; set; } = null!;

    /// <summary>
    /// Browsers must show a notification for every push they get, so only UnifiedPush (native app) subscriptions
    /// are sent silent pushes, like the one that clears notifications read on another device.
    /// </summary>
    public PushSubscriptionKind Kind { get; set; } = PushSubscriptionKind.Browser;
    
    public DateTime CreatedAt { get; set; }

    /// <summary>When a client last registered this endpoint. Ones not seen for a long time are deleted.</summary>
    public DateTime LastSeenAt { get; set; }

    public DateTime? LastSuccessAt { get; set; }

    public DateTime? LastFailureAt { get; set; }

    [StringLength(255)]
    public string? LastError { get; set; }

    /// <summary>Deliveries that failed for good in a row. Reset by a success.</summary>
    public int ConsecutiveFailures { get; set; }

    public static string HashUrl(string url) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(url))).ToLowerInvariant();
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    
    public PushSubscription ToPushSubscription() {
        PushSubscription s = new() {
            Endpoint = Url,
            Keys = new Dictionary<string, string>()
        };
        s.Keys["p256dh"] = P256dh;
        s.Keys["auth"] = Auth;
        return s;
    }
}

public enum PushSubscriptionKind {
    Browser = 0,
    UnifiedPush = 1
}
