using System.Text.Json.Serialization;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services.Notifications;

public enum NotificationLane {
    /// <summary>DMs, group chats and mentions. Some workers only take these, so a busy guild can't hold them up.</summary>
    High,
    Normal
}

/// <summary>Something for a notification worker to do. Stored in Redis as JSON, so keep it plain data.</summary>
[JsonPolymorphic(TypeDiscriminatorPropertyName = "t")]
[JsonDerivedType(typeof(FanOutJob), "fanout")]
[JsonDerivedType(typeof(DeliveryJob), "deliver")]
[JsonDerivedType(typeof(SocketFallbackJob), "socket")]
[JsonDerivedType(typeof(ReadSyncJob), "read")]
public abstract record NotificationJob {
    public string Id { get; init; } = Guid.NewGuid().ToString("N");
    public NotificationLane Lane { get; init; } = NotificationLane.Normal;
    /// <summary>Times this job threw (e.g. the database was down). Deliveries count their own attempts separately.</summary>
    public int Crashes { get; init; }
}

/// <summary>A new message: work out who to notify and how, and queue a <see cref="DeliveryJob"/> per device.</summary>
public record FanOutJob : NotificationJob {
    public long ChannelId { get; init; }
    public long MessageId { get; init; }
    public string[] Mentions { get; init; } = [];
}

/// <summary>Tells a user's native apps a channel was read elsewhere, so they can clear its notifications.</summary>
public record ReadSyncJob : NotificationJob {
    public string UserId { get; init; } = null!;
    public long ChannelId { get; init; }
    public long MessageId { get; init; }
}

/// <summary>
/// A connected user was sent an in-app notification. When this runs (a few seconds later) it checks whether any of
/// their connections acknowledged it; if not, the connection was probably dead and the prepared pushes go out.
/// </summary>
public record SocketFallbackJob : NotificationJob {
    public string AckId { get; init; } = null!;
    public string UserId { get; init; } = null!;
    public long ChannelId { get; init; }
    public long MessageId { get; init; }
    public DateTime SentAt { get; init; }
    public DateTime MessageCreatedAt { get; init; }
    /// <summary>The pushes to send if nobody acknowledged. Built at fan-out time so this path needs no database.</summary>
    public DeliveryJob[] Deliveries { get; init; } = [];
}

/// <summary>One notification to one push endpoint or ntfy topic. Carries everything needed to send it.</summary>
public record DeliveryJob : NotificationJob {
    public NotificationPurpose Purpose { get; init; }
    public NotificationTransport Transport { get; init; }
    public string UserId { get; init; } = null!;
    public long? ChannelId { get; init; }
    public long? MessageId { get; init; }
    /// <summary>UserWebNotificationHooks.Id or UserNtfySubscriptions.Id.</summary>
    public long SubscriptionId { get; init; }
    public string Host { get; init; } = null!;

    // Web Push (browsers and UnifiedPush)
    public string? Endpoint { get; init; }
    public string? P256dh { get; init; }
    public string? Auth { get; init; }
    public string? Payload { get; init; }
    public bool HighUrgency { get; init; }
    public string? Topic { get; init; }

    // ntfy
    public string? NtfyServer { get; init; }
    public string? NtfyTopic { get; init; }
    public string? NtfyToken { get; init; }
    public string? NtfyTitle { get; init; }
    public string? NtfyMessage { get; init; }
    public int NtfyPriority { get; init; } = 3;
    public string? NtfyClick { get; init; }

    // Bookkeeping
    public DateTime QueuedAt { get; init; }
    public DateTime? MessageCreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? FirstAttemptAt { get; init; }
    public int Attempt { get; init; }
    /// <summary>Whether the client will acknowledge it (our own payloads carry the ack ID; ntfy's app can't).</summary>
    public bool Ackable { get; init; }
    /// <summary>The subscription's failure count when this was queued, so a success only writes when it changes something.</summary>
    public int SubscriptionFailures { get; init; }
    public DateTime? SubscriptionLastSuccessAt { get; init; }
}
