using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;
using StackExchange.Redis;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class UserRepo(ChatDatabaseContext context, IConnectionMultiplexer redis) : IUserRepo {
    
    public async Task<ChatUser> CreateUser(ChatUser user) {
        context.Users.Add(user);
        await context.SaveChangesAsync();
        return user;
    }

    public async Task<ChatUser?> GetUserById(string id) { 
        return await context.Users.FirstOrDefaultAsync(u => u.Id == id);
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

    public async Task<UserChannelNotificationPreferences> GetChannelNotificationPreferences(string userId, int channelId) {
        return await context.UserChannelNotificationPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.ChannelId == channelId)
            ?? new UserChannelNotificationPreferences { UserId = userId, ChannelId = channelId };
    }

    public Task<Dictionary<int, UserChannelNotificationPreferences>> GetAllChannelNotificationPreferences(string userId) {
        return context.UserChannelNotificationPreferences
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.ChannelId);
    }

    public async Task<UserGuildNotificationPreferences> GetUserGuildNotificationPreferences(string userId, int guildId) {
        return await context.UserGuildNotificationPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.GuildId == guildId)
            ?? new UserGuildNotificationPreferences { UserId = userId };
    }

    public Task<Dictionary<int, UserGuildNotificationPreferences>> GetAllUserGuildNotificationPreferences(string userId) {
        return context.UserGuildNotificationPreferences
            .Where(p => p.UserId == userId)
            .ToDictionaryAsync(p => p.GuildId);
    }

    public async Task SetChannelNotificationPreferences(string userId, int channelId, UserChannelNotificationPreferences preferences) {
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

    public async Task SetUserGuildNotificationPreferences(string userId, int guildId, UserGuildNotificationPreferences preferences) {
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

    public Task<Dictionary<string, UserChannelNotificationPreferences>> GetUsersChannelNotificationPreferences(IEnumerable<string> userIds, int channelId) {
        return context.UserChannelNotificationPreferences
            .Where(p => userIds.Contains(p.UserId) && p.ChannelId == channelId)
            .ToDictionaryAsync(p => p.UserId);
    }

    public Task<Dictionary<string, UserGuildNotificationPreferences>> GetUsersGuildNotificationPreferences(IEnumerable<string> userIds, int guildId) {
        return context.UserGuildNotificationPreferences
            .Where(p => userIds.Contains(p.UserId) && p.GuildId == guildId)
            .ToDictionaryAsync(p => p.UserId);
    }

    public Task CreateWebNotificationSubscription(UserWebNotificationHook subscription) {
        context.UserWebNotificationHooks.Add(subscription);
        return context.SaveChangesAsync();
    }

    public async Task<IEnumerable<UserWebNotificationHook>> GetWebNotificationSubscriptions(string userId) {
        return await context.UserWebNotificationHooks
            .Where(h => h.UserId == userId)
            .ToArrayAsync();
    }

    public Task DeleteWebNotificationSubscriptions(params int[] subscriptionId) {
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

    public Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user) {
        if (user == null!) {
            throw new ArgumentNullException(nameof(user));
        }
        bool isOnline = redis.GetDatabase().StringGet("status:" + user.Id).HasValue;
        return Task.FromResult(PublicUserResponse.FromChatUser(user, isOnline));
    }
}
