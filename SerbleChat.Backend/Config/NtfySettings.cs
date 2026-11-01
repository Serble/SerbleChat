namespace SerbleChat.Backend.Config;

public class NtfySettings {
    /// <summary>
    /// Allow ntfy servers that resolve to loopback, private, link-local or other non-public addresses.
    /// Leave this off in production: users choose the server URL, so allowing it would let them make
    /// the backend send requests to internal services. Useful for testing or a LAN-only deployment.
    /// </summary>
    public bool AllowPrivateAddresses { get; set; } = false;

    public int MaxSubscriptionsPerUser { get; set; } = 5;

    public int TimeoutSeconds { get; set; } = 10;

    /// <summary>Delivery is disabled after this many consecutive failures. The user can re-enable it.</summary>
    public int DisableAfterFailures { get; set; } = 10;
}
