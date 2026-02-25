namespace SerbleChat.Backend.Services.Impl;

public class NotificationBackgroundService(ILogger<NotificationBackgroundService> logger, INotificationService service) 
    : BackgroundService {
    
    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        Task[] tasks = Enumerable
            .Range(0, 8)
            .Select(_ => Task.Run(() => Worker(stoppingToken), stoppingToken))
            .ToArray();

        await Task.WhenAll(tasks);
    }

    private async Task Worker(CancellationToken token) {
        while (!token.IsCancellationRequested) {
            Func<Task> workItem = await service.DequeueWork(token);
            try {
                await workItem();
            }
            catch (Exception e) {
                logger.LogError(e, "Error occurred executing background work item.");
            }
        }
    }
}
