using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace SerbleChat.Backend.Database.Structs;

/// <summary>
/// One attempt to get a notification to one device or connection, kept for statistics: how long delivery takes,
/// how often it fails, and which push services we talk to. Written in batches after the outcome is known.
/// </summary>
/// <remarks>Times are UTC. Millisecond columns are null when the stage never happened.</remarks>
[Index(nameof(CreatedAt))]
[Index(nameof(Host), nameof(CreatedAt))]
[Index(nameof(UserId), nameof(CreatedAt))]
public class NotificationDelivery {
    [Key]
    public long Id { get; set; }

    /// <summary>When the delivery was queued (for socket notifications: sent).</summary>
    public DateTime CreatedAt { get; set; }

    public NotificationPurpose Purpose { get; set; }

    public NotificationTransport Transport { get; set; }

    public NotificationOutcome Outcome { get; set; }

    /// <summary>High for DMs, group chats and mentions; they skip ahead of busy guilds.</summary>
    public bool HighPriority { get; set; }

    [StringLength(64)]
    public string UserId { get; set; } = null!;

    public long? ChannelId { get; set; }

    public long? MessageId { get; set; }

    /// <summary>The push service or ntfy server, e.g. fcm.googleapis.com. "socket" for in-app notifications.</summary>
    [StringLength(255)]
    public string Host { get; set; } = null!;

    /// <summary>UserWebNotificationHooks.Id or UserNtfySubscriptions.Id, depending on <see cref="Transport"/>.</summary>
    public long? SubscriptionId { get; set; }

    public DateTime? MessageCreatedAt { get; set; }

    public DateTime? FirstAttemptAt { get; set; }

    public DateTime? CompletedAt { get; set; }

    public int Attempts { get; set; }

    /// <summary>HTTP status of the last attempt, if it got that far.</summary>
    public int? StatusCode { get; set; }

    [StringLength(255)]
    public string? Error { get; set; }

    /// <summary>Message created → first attempt: time spent before we even tried (DB, queueing, waiting for a worker).</summary>
    public int? QueueMs { get; set; }

    /// <summary>How long the push service took to answer the last attempt.</summary>
    public int? PushServiceMs { get; set; }

    /// <summary>Message created → push service accepted it (or the socket ack, for in-app notifications).</summary>
    public int? AcceptedMs { get; set; }

    /// <summary>When the device's acknowledgement reached us. Needs a client that sends them.</summary>
    public DateTime? DeviceAckAt { get; set; }

    /// <summary>
    /// Message created → acknowledgement received. An upper bound on delivery time: it includes the device getting
    /// its network back after being woken, which on Android can take the best part of a second.
    /// </summary>
    public int? DeviceAckMs { get; set; }

    /// <summary>
    /// Message created → the notification was on screen, by the device's own clock. The most accurate end-to-end
    /// figure, but only as good as the device's clock (phones are usually within tens of milliseconds).
    /// </summary>
    public int? DeviceShownMs { get; set; }
}

public enum NotificationPurpose {
    Message = 0,
    /// <summary>Tells a native app to clear notifications for a channel read elsewhere.</summary>
    ReadSync = 1
}

public enum NotificationTransport {
    /// <summary>In-app notification over the SignalR connection.</summary>
    Socket = 0,
    /// <summary>Web Push to a browser.</summary>
    WebPush = 1,
    /// <summary>Web Push to a native app through a UnifiedPush distributor (ntfy, the embedded FCM one...).</summary>
    UnifiedPush = 2,
    /// <summary>A plain ntfy topic the user configured.</summary>
    Ntfy = 3
}

public enum NotificationOutcome {
    /// <summary>The push service accepted it.</summary>
    Delivered = 0,
    /// <summary>Failed for good, either straight away (4xx) or after running out of retries.</summary>
    Failed = 1,
    /// <summary>Still failing when it stopped being worth sending.</summary>
    Expired = 2,
    /// <summary>The push service said the subscription no longer exists (404/410); it was deleted.</summary>
    SubscriptionGone = 3,
    /// <summary>In-app notification a client acknowledged.</summary>
    Acked = 4,
    /// <summary>In-app notification nobody acknowledged in time, so it was pushed instead.</summary>
    NotAcked = 5
}
