namespace SerbleChat.Backend.Config;

public class PushNotificationsSettings {
    public string VapidPublicKey { get; set; } = null!;
    public string VapidPrivateKey { get; set; } = null!;
    public string Subject { get; set; } = null!;

    /// <summary>
    /// Accept push endpoints that use plain http or resolve to loopback, private or other non-public addresses.
    /// Leave this off in production: clients choose the endpoint URL, so allowing it would let anyone make the
    /// backend send requests to internal services. Useful for testing against a LAN ntfy server.
    /// </summary>
    public bool AllowPrivateEndpoints { get; set; } = false;

    /// <summary>How long a single request to a push service may take before it counts as a (retryable) failure.</summary>
    public int TimeoutSeconds { get; set; } = 10;
}
