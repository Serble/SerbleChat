using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database;
using SerbleChat.Backend.Database.Structs;
using StackExchange.Redis;

namespace SerbleChat.Backend.Services.Notifications;

/// <summary>
/// Writes <see cref="NotificationDelivery"/> rows in batches, off the delivery path. Rows for pushes the device will
/// acknowledge are held for a short window first, so the acknowledgement lands in the same insert.
/// </summary>
/// <remarks>
/// Device acknowledgements arrive over HTTP (possibly at another instance), so they go to Redis and are looked up
/// here. One that arrives after the window isn't recorded. Rows still held when the process stops are flushed
/// without waiting; rows in memory when it crashes are lost, which is fine for statistics.
/// </remarks>
public class DeliveryRecorder(
    IServiceScopeFactory scopes,
    IConnectionMultiplexer redis,
    IOptions<NotificationSettings> settings,
    ILogger<DeliveryRecorder> logger) : BackgroundService {

    private const int MaxBuffered = 100_000;
    private static readonly TimeSpan AckTtl = TimeSpan.FromMinutes(10);
    public static RedisKey DeviceAckKey(string deliveryId) => "nq:dack:" + deliveryId;

    private readonly ConcurrentQueue<(NotificationDelivery Row, string? AckId, DateTime Due)> _pending = new();
    private int _count;

    /// <summary>Records a finished delivery. Pass the ack ID for pushes the device will acknowledge.</summary>
    public void Record(NotificationDelivery row, string? awaitAckId = null) {
        if (!settings.Value.RecordDeliveries) return;
        if (row.Transport == NotificationTransport.Socket && !settings.Value.RecordSocketDeliveries) return;
        if (Interlocked.Increment(ref _count) > MaxBuffered) {
            Interlocked.Decrement(ref _count);
            return;  // the database can't keep up; statistics aren't worth running out of memory over
        }
        DateTime due = awaitAckId == null ? DateTime.MinValue : DateTime.UtcNow.AddSeconds(settings.Value.DeviceAckWindowSeconds);
        _pending.Enqueue((row, awaitAckId, due));
    }

    /// <summary>A device says it showed the notification for this delivery, at <paramref name="shownAt"/> by its clock.</summary>
    public Task AckFromDevice(string deliveryId, long? shownAt) {
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // ignore a shown time that's nonsense (a clock days out)
        string value = shownAt is { } s && Math.Abs(now - s) < TimeSpan.FromHours(1).TotalMilliseconds ? $"{now}:{s}" : $"{now}";
        return redis.GetDatabase().StringSetAsync(DeviceAckKey(deliveryId), value, AckTtl, When.NotExists);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        while (!stoppingToken.IsCancellationRequested) {
            try {
                await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            }
            catch (OperationCanceledException) {
                break;
            }
            await Flush(force: false);
        }
        await Flush(force: true);
    }

    private async Task Flush(bool force) {
        try {
            DateTime now = DateTime.UtcNow;
            List<(NotificationDelivery Row, string? AckId)> ready = [];
            List<(NotificationDelivery, string?, DateTime)> notYet = [];
            // The queue is in roughly due order, but not strictly (immediate rows sit behind waiting ones), so sort it out here
            int n = _pending.Count;
            for (int i = 0; i < n && _pending.TryDequeue(out (NotificationDelivery Row, string? AckId, DateTime Due) item); i++) {
                if (force || item.Due <= now) ready.Add((item.Row, item.AckId));
                else notYet.Add(item);
            }
            foreach ((NotificationDelivery, string?, DateTime) item in notYet) _pending.Enqueue(item);
            if (ready.Count == 0) return;
            Interlocked.Add(ref _count, -ready.Count);

            await AttachAcks(ready);

            using IServiceScope scope = scopes.CreateScope();
            ChatDatabaseContext db = scope.ServiceProvider.GetRequiredService<ChatDatabaseContext>();
            foreach ((NotificationDelivery Row, string? AckId)[] chunk in ready.Chunk(1000)) {
                db.NotificationDeliveries.AddRange(chunk.Select(c => c.Row));
                await db.SaveChangesAsync();
                db.ChangeTracker.Clear();
            }
        }
        catch (Exception e) {
            logger.LogWarning(e, "Failed to write notification delivery statistics");
        }
    }

    private async Task AttachAcks(List<(NotificationDelivery Row, string? AckId)> rows) {
        List<(NotificationDelivery Row, string AckId)> ackable = rows
            .Where(r => r.AckId != null)
            .Select(r => (r.Row, r.AckId!))
            .ToList();
        if (ackable.Count == 0) return;
        IDatabase db = redis.GetDatabase();
        foreach ((NotificationDelivery Row, string AckId)[] chunk in ackable.Chunk(500)) {
            RedisValue[] values = await db.StringGetAsync(chunk.Select(c => DeviceAckKey(c.AckId)).ToArray());
            for (int i = 0; i < chunk.Length; i++) {
                if (!values[i].HasValue) continue;
                string[] parts = ((string)values[i]!).Split(':');
                DateTime ackAt = DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(parts[0])).UtcDateTime;
                NotificationDelivery row = chunk[i].Row;
                row.DeviceAckAt = ackAt;
                if (row.MessageCreatedAt.HasValue) {
                    row.DeviceAckMs = Ms(ackAt - row.MessageCreatedAt.Value);
                    if (parts.Length > 1) {
                        DateTime shownAt = DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(parts[1])).UtcDateTime;
                        row.DeviceShownMs = Ms(shownAt - row.MessageCreatedAt.Value);
                    }
                }
            }
        }
    }

    public static int? Ms(TimeSpan span) => span < TimeSpan.Zero ? 0 : (int)Math.Min(int.MaxValue, span.TotalMilliseconds);
}
