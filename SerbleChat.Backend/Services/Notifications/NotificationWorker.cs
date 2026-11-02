using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SerbleChat.Backend.Config;
using SerbleChat.Backend.Database;
using SerbleChat.Backend.Database.Repos;

namespace SerbleChat.Backend.Services.Notifications;

/// <summary>
/// Runs the notification queue: workers that take any job, workers that only take high-priority ones, a loop that
/// releases delayed jobs and abandoned claims, and periodic cleanup.
/// </summary>
public class NotificationWorker(
    NotificationQueue queue,
    NotificationService notifications,
    IServiceScopeFactory scopes,
    IOptions<NotificationSettings> settings,
    ILogger<NotificationWorker> logger) : BackgroundService {

    private static readonly NotificationLane[] AnyLane = [NotificationLane.High, NotificationLane.Normal];
    private static readonly NotificationLane[] HighOnly = [NotificationLane.High];

    protected override Task ExecuteAsync(CancellationToken stoppingToken) {
        NotificationSettings s = settings.Value;
        List<Task> tasks = [
            Task.Run(() => Promoter(stoppingToken), stoppingToken),
            Task.Run(() => Maintenance(stoppingToken), stoppingToken)
        ];
        tasks.AddRange(Enumerable.Range(0, Math.Max(1, s.Workers)).Select(_ => Task.Run(() => Worker(AnyLane, stoppingToken), stoppingToken)));
        tasks.AddRange(Enumerable.Range(0, Math.Max(0, s.HighPriorityWorkers)).Select(_ => Task.Run(() => Worker(HighOnly, stoppingToken), stoppingToken)));
        return Task.WhenAll(tasks);
    }

    private async Task Worker(NotificationLane[] lanes, CancellationToken token) {
        while (!token.IsCancellationRequested) {
            try {
                ClaimedJob? claimed = await queue.TryClaim(lanes);
                if (claimed == null) {
                    // Woken by a local enqueue, or poll for delayed jobs and other instances' work
                    await queue.WaitForWork(TimeSpan.FromSeconds(1), token);
                    continue;
                }
                // Not cancelled by shutdown: a send is short (it times out), and finishing it beats running it twice
                await notifications.Process(claimed);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) {
                break;
            }
            catch (Exception e) {
                logger.LogError(e, "Notification worker error");
                await Delay(TimeSpan.FromSeconds(1), token);
            }
        }
    }

    private async Task Promoter(CancellationToken token) {
        while (!token.IsCancellationRequested) {
            try {
                await queue.Promote();
            }
            catch (Exception e) {
                logger.LogWarning(e, "Couldn't promote delayed notification jobs");
            }
            await Delay(TimeSpan.FromMilliseconds(250), token);
        }
    }

    private async Task Maintenance(CancellationToken token) {
        await Delay(TimeSpan.FromMinutes(1), token);
        while (!token.IsCancellationRequested) {
            try {
                using IServiceScope scope = scopes.CreateScope();
                NotificationSettings s = settings.Value;
                int stale = await scope.ServiceProvider.GetRequiredService<IUserRepo>()
                    .DeleteStaleWebNotificationSubscriptions(DateTime.UtcNow.AddDays(-s.StaleEndpointDays));
                if (stale > 0) logger.LogInformation("Deleted {Count} push subscriptions not registered for {Days} days", stale, s.StaleEndpointDays);

                // In chunks, so a big backlog doesn't hold a long lock
                ChatDatabaseContext db = scope.ServiceProvider.GetRequiredService<ChatDatabaseContext>();
                DateTime cutoff = DateTime.UtcNow.AddDays(-s.StatsRetentionDays);
                int deleted;
                do {
                    deleted = await db.Database.ExecuteSqlInterpolatedAsync(
                        $"DELETE FROM NotificationDeliveries WHERE CreatedAt < {cutoff} LIMIT 10000", token);
                } while (deleted > 0 && !token.IsCancellationRequested);

                QueueDepth depth = await queue.GetDepth();
                logger.LogInformation("Notification queue: {High} high, {Normal} normal ready, {Delayed} delayed, {InFlight} in flight",
                    depth.ReadyHigh, depth.ReadyNormal, depth.Delayed, depth.InFlight);
            }
            catch (Exception e) when (!token.IsCancellationRequested) {
                logger.LogWarning(e, "Notification maintenance failed");
            }
            await Delay(TimeSpan.FromHours(6), token);
        }
    }

    private static async Task Delay(TimeSpan delay, CancellationToken token) {
        try {
            await Task.Delay(delay, token);
        }
        catch (OperationCanceledException) {
            // shutting down
        }
    }
}
