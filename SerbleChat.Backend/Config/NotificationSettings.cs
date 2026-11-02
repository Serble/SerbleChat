namespace SerbleChat.Backend.Config;

/// <summary>The notification pipeline: queue, retries, socket acknowledgements and delivery statistics.</summary>
public class NotificationSettings {
    /// <summary>Workers that take any job. Deliveries are network-bound, so this can be well above the core count.</summary>
    public int Workers { get; set; } = 64;

    /// <summary>Extra workers that only take high-priority jobs (DMs, group chats, mentions), so busy guilds can't delay them.</summary>
    public int HighPriorityWorkers { get; set; } = 16;

    /// <summary>Attempts per delivery, counting the first, before a transient failure is given up on.</summary>
    public int MaxAttempts { get; set; } = 6;

    /// <summary>A delivery that hasn't succeeded after this long is dropped, and push services are told not to keep it longer.</summary>
    public int MessageTtlHours { get; set; } = 24;

    /// <summary>
    /// A user who's connected only gets an in-app notification. If no connection acknowledges it within this many
    /// seconds the connection is probably dead (e.g. the phone lost signal with the app open), so it's pushed instead.
    /// </summary>
    public int SocketAckTimeoutSeconds { get; set; } = 5;

    /// <summary>A job claimed by a worker that's gone quiet (crashed instance) goes back on the queue after this long.</summary>
    public int JobLeaseSeconds { get; set; } = 30;

    /// <summary>Push endpoints their client hasn't re-registered for this long are deleted (e.g. the app was uninstalled).</summary>
    public int StaleEndpointDays { get; set; } = 60;

    /// <summary>
    /// A push endpoint is deleted after this many failed deliveries in a row, as long as it also hasn't worked for a week.
    /// 404 and 410 delete it straight away.
    /// </summary>
    public int DeleteEndpointAfterFailures { get; set; } = 25;

    /// <summary>Push endpoints a user may have. Registering another replaces the one least recently registered.</summary>
    public int MaxEndpointsPerUser { get; set; } = 10;

    /// <summary>
    /// A push host that times out or refuses connections this many times within a minute is skipped (deliveries to it
    /// wait for a retry) for <see cref="HostCooldownSeconds"/>, so a dead or deliberately slow host can't tie up workers.
    /// </summary>
    public int HostFailureThreshold { get; set; } = 3;

    public int HostCooldownSeconds { get; set; } = 20;

    /// <summary>Whether to keep a row per delivery in NotificationDeliveries.</summary>
    public bool RecordDeliveries { get; set; } = true;

    /// <summary>Whether in-app (socket) notifications get a row too. They're the most numerous by far.</summary>
    public bool RecordSocketDeliveries { get; set; } = true;

    /// <summary>How long to wait for a device to confirm it got a push before writing the delivery's row without it.</summary>
    public int DeviceAckWindowSeconds { get; set; } = 30;

    /// <summary>Delivery rows older than this are deleted.</summary>
    public int StatsRetentionDays { get; set; } = 30;
}
