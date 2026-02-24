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

    public Task<PublicUserResponse> CompilePublicUserResponse(ChatUser user) {
        if (user == null!) {
            throw new ArgumentNullException(nameof(user));
        }
        bool isOnline = redis.GetDatabase().StringGet("status:" + user.Id).HasValue;
        return Task.FromResult(PublicUserResponse.FromChatUser(user, isOnline));
    }
}
