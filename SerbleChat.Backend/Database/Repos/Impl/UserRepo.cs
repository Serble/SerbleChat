using SerbleChat.Backend.Services.Ntfy;
using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using SerbleChat.Backend.Services;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class UserRepo(ChatDatabaseContext context, IPresenceService presence) : IUserRepo {
    
    public async Task<ChatUser> CreateUser(ChatUser user) {
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    public async Task<ChatUser?> GetUserById(string id) { 
        return await context.Users.FirstOrDefaultAsync(u => u.Id == id);
    }
    
    public Task<ChatUser[]> GetUsersByIds(IEnumerable<string> ids) {
        string[] list = ids.Distinct().ToArray();
        return context.Users.Where(u => list.Contains(u.Id)).ToArrayAsync();
    }

    public async Task<ChatUser?> GetUserByUsername(string username) {
        return await context.Users.FirstOrDefaultAsync(u => u.Username == username);
    }
    
    public async Task UpdateRefreshToken(string id, string refreshToken) {
        ChatUser? user = await context.Users.FindAsync(id);
        if (user != null) {
            user.RefreshToken = refreshToken;
            await context.SaveChangesAsync();
        }
    }

    public async Task UpdateUser(ChatUser user) {
        context.Entry(user).State = EntityState.Modified;
        await context.SaveChangesAsync();
    }

    public async Task SetAvatarVersion(ChatUser user, long version) {
        await context.Users.Where(u => u.Id == user.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(u => u.AvatarVersion, version));
        user.AvatarVersion = version;
    }

    public Task<bool> AreUsersBlocked(string userId1, string userId2) {
        return context.UserBlocks.AnyAsync(b =>
            (b.UserId == userId1 && b.BlockedUserId == userId2) ||
            (b.UserId == userId2 && b.BlockedUserId == userId1));
    }

    public Task BlockUser(string blockerId, string blockedId) {
        if (context.UserBlocks.Any(b => b.UserId == blockerId && b.BlockedUserId == blockedId)) {
            return Task.CompletedTask;
        }
        context.UserBlocks.Add(new UserBlock {
            UserId = blockerId, BlockedUserId = blockedId
        });
        return context.SaveChangesAsync();
    }

    public Task UnblockUser(string blockerId, string blockedId) {
        return context.UserBlocks
            .Where(b => b.UserId == blockerId && b.BlockedUserId == blockedId)
            .ExecuteDeleteAsync();
    }

    public Task<UserBlock[]> GetBlockedUsers(string userId) {
        return context.UserBlocks
            .Where(b => b.UserId == userId)
            .Include(b => b.BlockedUserNavigation)
            .ToArrayAsync();
    }

    public async Task<string> GetClientOptions(string userId) {
        return (await context.ClientOptions.FindAsync(userId) ?? new ClientOptionsData()).OptionsJson;
    }

    public async Task SetClientOptions(string userId, string options) {
        int updated = await context.ClientOptions
            .Where(o => o.UserId == userId)
            .ExecuteUpdateAsync(u => u.SetProperty(o => o.OptionsJson, options));
        if (updated == 0) {
            context.ClientOptions.Add(new ClientOptionsData { UserId = userId, OptionsJson = options });
            await context.SaveChangesAsync();
        }
    }

    public async Task<UserChannelNotificationPreferences> GetChannelNotificationPreferences(string userId, long channelId) {
        return await context.UserChannelNotificationPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ChannelId == channelId)
            ?? new UserChannelNotificationPreferences { UserId = userId, ChannelId = channelId };
    }

    public Task<Dictionary<long, UserChannelNotificationPreferences>> GetAllChannelNotificationPreferences(string userId) {
        return context.UserChannelNotificationPreferences
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.ChannelId);
    }

    public async Task<UserGuildNotificationPreferences> GetUserGuildNotificationPreferences(string userId, long guildId) {
        return await context.UserGuildNotificationPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.GuildId == guildId)
            ?? new UserGuildNotificationPreferences { UserId = userId };
    }

    public Task<Dictionary<long, UserGuildNotificationPreferences>> GetAllUserGuildNotificationPreferences(string userId) {
        return context.UserGuildNotificationPreferences
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.GuildId);
    }

    public async Task SetChannelNotificationPreferences(string userId, long channelId, UserChannelNotificationPreferences preferences) {
        int updated = await context.UserChannelNotificationPreferences
            .Where(p => p.UserId == userId && p.ChannelId == channelId)
            .ExecuteUpdateAsync(u => u
                .SetProperty(p => p.Preferences.Notifications, preferences.Preferences.Notifications)
                .SetProperty(p => p.Preferences.Unreads, preferences.Preferences.Unreads));
        if (updated == 0) {
            context.UserChannelNotificationPreferences.Add(preferences);
            await context.SaveChangesAsync();
        }
    }

    public async Task SetUserGuildNotificationPreferences(string userId, long guildId, UserGuildNotificationPreferences preferences) {
        int updated = await context.UserGuildNotificationPreferences
            .Where(p => p.UserId == userId && p.GuildId == guildId)
            .ExecuteUpdateAsync(u => u
                .SetProperty(p => p.Preferences.Notifications, preferences.Preferences.Notifications)
                .SetProperty(p => p.Preferences.Unreads, preferences.Preferences.Unreads));
        if (updated == 0) {
            context.UserGuildNotificationPreferences.Add(preferences);
            await context.SaveChangesAsync();
        }
    }

    public Task<Dictionary<string, UserChannelNotificationPreferences>> GetUsersChannelNotificationPreferences(IEnumerable<string> userIds, long channelId) {
        return context.UserChannelNotificationPreferences
            .Where(p => userIds.Contains(p.UserId) && p.ChannelId == channelId)
            .ToDictionaryAsync(p => p.UserId);
    }

    public Task<Dictionary<string, UserGuildNotificationPreferences>> GetUsersGuildNotificationPreferences(IEnumerable<string> userIds, long guildId) {
        return context.UserGuildNotificationPreferences
            .Where(p => userIds.Contains(p.UserId) && p.GuildId == guildId)
            .ToDictionaryAsync(p => p.UserId);
    }

    public async Task UpsertWebNotificationSubscription(UserWebNotificationHook subscription, int maxPerUser) {
        await UpsertWebNotificationSubscription(subscription);
        // Keep the newest few: an endpoint a client stopped registering is the likeliest to be dead
        long[] excess = await context.UserWebNotificationHooks
            .Where(h => h.UserId == subscription.UserId)
            .OrderByDescending(h => h.LastSeenAt).ThenByDescending(h => h.Id)
            .Skip(maxPerUser)
            .Select(h => h.Id)
            .ToArrayAsync();
        if (excess.Length > 0) {
            await DeleteWebNotificationSubscriptions(excess);
        }
    }

    public async Task UpsertWebNotificationSubscription(UserWebNotificationHook subscription) {
        subscription.UrlHash = UserWebNotificationHook.HashUrl(subscription.Url);
        subscription.LastSeenAt = DateTime.UtcNow;
        // Two registrations at once both miss the lookup; the unique index makes the loser update instead.
        for (int attempt = 0; ; attempt++) {
            UserWebNotificationHook? hook = await context.UserWebNotificationHooks
                .FirstOrDefaultAsync(h => h.UrlHash == subscription.UrlHash);
            if (hook == null) {
                context.UserWebNotificationHooks.Add(subscription);
                try {
                    await context.SaveChangesAsync();
                    return;
                }
                catch (DbUpdateException) when (attempt == 0) {
                    context.Entry(subscription).State = EntityState.Detached;
                    continue;
                }
            }

            bool keysChanged = hook.P256dh != subscription.P256dh || hook.Auth != subscription.Auth;
            hook.UserId = subscription.UserId;
            hook.P256dh = subscription.P256dh;
            hook.Auth = subscription.Auth;
            hook.UserAgent = subscription.UserAgent;
            hook.Kind = subscription.Kind;
            hook.LastSeenAt = subscription.LastSeenAt;
            if (keysChanged) {
                hook.ConsecutiveFailures = 0;  // new keys are a fresh start
            }
            await context.SaveChangesAsync();
            return;
        }
    }

    public Task<UserWebNotificationHook?> GetWebNotificationSubscriptionByUrl(string url) {
        string hash = UserWebNotificationHook.HashUrl(url);
        return context.UserWebNotificationHooks.FirstOrDefaultAsync(h => h.UrlHash == hash);
    }

    public async Task<bool> ReplaceWebNotificationSubscriptionUrl(string oldUrl, string newUrl, string p256dh, string auth) {
        UserWebNotificationHook? hook = await GetWebNotificationSubscriptionByUrl(oldUrl);
        if (hook == null) return false;
        string newHash = UserWebNotificationHook.HashUrl(newUrl);
        // the new endpoint may already be registered (the page got there first)
        await context.UserWebNotificationHooks
            .Where(h => h.UrlHash == newHash && h.Id != hook.Id)
            .ExecuteDeleteAsync();
        hook.Url = newUrl;
        hook.UrlHash = newHash;
        hook.P256dh = p256dh;
        hook.Auth = auth;
        hook.LastSeenAt = DateTime.UtcNow;
        hook.ConsecutiveFailures = 0;
        await context.SaveChangesAsync();
        return true;
    }

    public Task RecordWebPushSuccess(long hookId) {
        return context.UserWebNotificationHooks
            .Where(h => h.Id == hookId)
            .ExecuteUpdateAsync(u => u
                .SetProperty(h => h.LastSuccessAt, DateTime.UtcNow)
                .SetProperty(h => h.ConsecutiveFailures, 0));
    }

    public async Task<bool> RecordWebPushFailure(long hookId, string error, int deleteAfterFailures, TimeSpan deleteIfNoSuccessFor) {
        DateTime now = DateTime.UtcNow;
        if (error.Length > 255) error = error[..255];
        await context.UserWebNotificationHooks
            .Where(h => h.Id == hookId)
            .ExecuteUpdateAsync(u => u
                .SetProperty(h => h.LastFailureAt, now)
                .SetProperty(h => h.LastError, error)
                .SetProperty(h => h.ConsecutiveFailures, h => h.ConsecutiveFailures + 1));
        // Only give up on an endpoint that keeps failing and hasn't worked in a while: one bad day isn't enough.
        DateTime cutoff = now - deleteIfNoSuccessFor;
        return await context.UserWebNotificationHooks
            .Where(h => h.Id == hookId && h.ConsecutiveFailures >= deleteAfterFailures
                        && (h.LastSuccessAt == null ? h.CreatedAt < cutoff : h.LastSuccessAt < cutoff))
            .ExecuteDeleteAsync() > 0;
    }

    public Task<int> DeleteStaleWebNotificationSubscriptions(DateTime notSeenSince) {
        return context.UserWebNotificationHooks
            .Where(h => h.LastSeenAt < notSeenSince)
            .ExecuteDeleteAsync();
    }

    public async Task<bool> DeleteWebNotificationSubscription(string userId, string url) {
        return await context.UserWebNotificationHooks
            .Where(h => h.UserId == userId && h.Url == url)
            .ExecuteDeleteAsync() > 0;
    }

    public async Task<IEnumerable<UserWebNotificationHook>> GetWebNotificationSubscriptions(string userId) {
        return await context.UserWebNotificationHooks
            .Where(h => h.UserId == userId)
            .ToArrayAsync();
    }

    public Task DeleteWebNotificationSubscriptions(params long[] subscriptionId) {
        return context.UserWebNotificationHooks
            .Where(h => subscriptionId.Contains(h.Id))
            .ExecuteDeleteAsync();
    }

    public Task<Dictionary<string, IEnumerable<UserWebNotificationHook>>> GetUsersWebNotificationSubscriptions(IEnumerable<string> userIds) {
        return context.UserWebNotificationHooks
            .Where(h => userIds.Contains(h.UserId))
            .GroupBy(h => h.UserId)
            .ToDictionaryAsync(g => g.Key, g => g.AsEnumerable());
    }

    public Task CreateNtfySubscription(UserNtfySubscription subscription) {
        context.UserNtfySubscriptions.Add(subscription);
        return context.SaveChangesAsync();
    }

    public Task<UserNtfySubscription[]> GetNtfySubscriptions(string userId) {
        return context.UserNtfySubscriptions
            .Where(s => s.UserId == userId)
            .OrderBy(s => s.Id)
            .ToArrayAsync();
    }

    public Task<UserNtfySubscription?> GetNtfySubscription(string userId, long id) {
        return context.UserNtfySubscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId && s.Id == id);
    }

    public Task<int> CountNtfySubscriptions(string userId) {
        return context.UserNtfySubscriptions.CountAsync(s => s.UserId == userId);
    }

    public Task UpdateNtfySubscription(UserNtfySubscription subscription) {
        context.UserNtfySubscriptions.Update(subscription);
        return context.SaveChangesAsync();
    }

    public Task DeleteNtfySubscription(UserNtfySubscription subscription) {
        context.UserNtfySubscriptions.Remove(subscription);
        return context.SaveChangesAsync();
    }

    public async Task<Dictionary<string, UserNtfySubscription[]>> GetUsersEnabledNtfySubscriptions(IEnumerable<string> userIds) {
        UserNtfySubscription[] subs = await context.UserNtfySubscriptions
            .Where(s => s.Enabled && userIds.Contains(s.UserId))
            .ToArrayAsync();
        return subs.GroupBy(s => s.UserId).ToDictionary(g => g.Key, g => g.ToArray());
    }

    public async Task RecordNtfyDeliveryResults(IEnumerable<long> succeeded, IEnumerable<NtfyDeliveryFailure> failed, int disableAfterFailures) {
        DateTime now = DateTime.UtcNow;

        long[] okIds = succeeded.ToArray();
        if (okIds.Length > 0) {
            await context.UserNtfySubscriptions
                .Where(s => okIds.Contains(s.Id))
                .ExecuteUpdateAsync(u => u
                    .SetProperty(s => s.LastSuccessAt, now)
                    .SetProperty(s => s.ConsecutiveFailures, 0));
        }

        foreach (NtfyDeliveryFailure failure in failed) {
            string error = failure.Error.Length > 255 ? failure.Error[..255] : failure.Error;
            // Rate limiting is usually the shared server IP being throttled (ntfy.sh without a token), not this
            // subscription's fault, so it doesn't count. Rejections count like any other failure: a 401 or 404 can be
            // a server mid-deploy or a proxy hiccup, and switching notifications off over one would be worse.
            int increment = failure.Outcome == NtfyPublishOutcome.RateLimited ? 0 : 1;
            await context.UserNtfySubscriptions
                .Where(s => s.Id == failure.SubscriptionId)
                .ExecuteUpdateAsync(u => u
                    .SetProperty(s => s.LastFailureAt, now)
                    .SetProperty(s => s.LastError, error)
                    .SetProperty(s => s.ConsecutiveFailures, s => s.ConsecutiveFailures + increment)
                    .SetProperty(s => s.Enabled, s => s.Enabled && s.ConsecutiveFailures + increment < disableAfterFailures));
        }
    }

    public async Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user) {
        if (user == null!) {
            throw new ArgumentNullException(nameof(user));
        }
        return PublicUserResponse.FromChatUser(user, await presence.IsConnected(user.Id));
    }

    public async Task<PublicUserResponse[]> CompilePublicUserResponses(IReadOnlyCollection<ChatUser> users) {
        HashSet<string> connected = await presence.GetConnected(users.Select(u => u.Id));
        return users.Select(u => PublicUserResponse.FromChatUser(u, connected.Contains(u.Id))).ToArray();
    }
}
