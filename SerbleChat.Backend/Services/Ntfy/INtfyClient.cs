using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services.Ntfy;

public interface INtfyClient {
    Task<NtfyPublishResult> Publish(UserNtfySubscription subscription, NtfyNotification notification, CancellationToken token = default);

    /// <summary>Checks that the server's host resolves only to addresses the backend may connect to. Returns an error message, or null if allowed.</summary>
    Task<string?> CheckServerAddress(Uri serverUrl, CancellationToken token = default);
}

/// <param name="Priority">ntfy priority, 1 (min) to 5 (max). 3 is the default.</param>
public record NtfyNotification(string Title, string Message, int Priority = 3, string? Click = null, string[]? Tags = null);

public enum NtfyPublishOutcome {
    Success,
    /// <summary>Might work if retried later (network error, 5xx).</summary>
    Failed,
    /// <summary>The server is throttling us. Not the subscription's fault, so it doesn't count towards disabling it.</summary>
    RateLimited,
    /// <summary>Won't work until the user changes something (bad token, topic reserved by someone else, blocked address).</summary>
    Rejected
}

public record NtfyPublishResult(NtfyPublishOutcome Outcome, string? Error = null) {
    public bool Success => Outcome == NtfyPublishOutcome.Success;
}

public record NtfyDeliveryFailure(long SubscriptionId, NtfyPublishOutcome Outcome, string Error);
