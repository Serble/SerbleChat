using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database;

namespace SerbleChat.Backend.Services.Impl;

/// <summary>
/// Fills in the image versions of rows from before versions existed (marked -1 by the migration that added them),
/// from what is actually in S3: the object's last write time if there is one, else 0 for "no image".
/// </summary>
/// <remarks>
/// Does nothing once every row is known, so it is cheap to leave running on every start. Until it has run, clients
/// see -1 and fall back to the bare, unversioned URL.
/// </remarks>
public class ImageVersionBackfill(IServiceScopeFactory scopes, ILogger<ImageVersionBackfill> logger) : BackgroundService {
    protected override async Task ExecuteAsync(CancellationToken ct) {
        for (int attempt = 1; !ct.IsCancellationRequested; attempt++) {
            try {
                await Run(ct);
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) {
                return;
            }
            catch (Exception e) {
                logger.LogWarning(e, "Image version backfill failed (attempt {Attempt}), retrying", attempt);
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(300, 10 * attempt)), ct);
            }
        }
    }

    private async Task Run(CancellationToken ct) {
        using IServiceScope scope = scopes.CreateScope();
        ChatDatabaseContext db = scope.ServiceProvider.GetRequiredService<ChatDatabaseContext>();
        IImagesService images = scope.ServiceProvider.GetRequiredService<IImagesService>();

        // Each row is only written while it is still unknown, so an upload that lands mid-backfill keeps its version
        int updated = 0;
        if (await db.Users.AnyAsync(u => u.AvatarVersion < 0, ct)) {
            Dictionary<string, DateTime> stored = await images.ListImages("pfp/", ct);
            foreach (string id in await db.Users.Where(u => u.AvatarVersion < 0).Select(u => u.Id).ToListAsync(ct)) {
                long version = stored.TryGetValue($"pfp/{id}.webp", out DateTime at) ? IImagesService.VersionFor(at) : 0;
                updated += await db.Users.Where(u => u.Id == id && u.AvatarVersion < 0)
                    .ExecuteUpdateAsync(set => set.SetProperty(u => u.AvatarVersion, version), ct);
            }
        }
        if (await db.Guilds.AnyAsync(g => g.IconVersion < 0, ct)) {
            Dictionary<string, DateTime> stored = await images.ListImages("guild-icons/", ct);
            foreach (long id in await db.Guilds.Where(g => g.IconVersion < 0).Select(g => g.Id).ToListAsync(ct)) {
                long version = stored.TryGetValue($"guild-icons/{id}.webp", out DateTime at) ? IImagesService.VersionFor(at) : 0;
                updated += await db.Guilds.Where(g => g.Id == id && g.IconVersion < 0)
                    .ExecuteUpdateAsync(set => set.SetProperty(g => g.IconVersion, version), ct);
            }
        }
        if (await db.Channels.AnyAsync(c => c.IconVersion < 0, ct)) {
            Dictionary<string, DateTime> stored = await images.ListImages("channel-icons/", ct);
            foreach (long id in await db.Channels.Where(c => c.IconVersion < 0).Select(c => c.Id).ToListAsync(ct)) {
                long version = stored.TryGetValue($"channel-icons/{id}.webp", out DateTime at) ? IImagesService.VersionFor(at) : 0;
                updated += await db.Channels.Where(c => c.Id == id && c.IconVersion < 0)
                    .ExecuteUpdateAsync(set => set.SetProperty(c => c.IconVersion, version), ct);
            }
        }
        if (updated > 0) logger.LogInformation("Image version backfill: filled in {Count} rows", updated);
    }
}
