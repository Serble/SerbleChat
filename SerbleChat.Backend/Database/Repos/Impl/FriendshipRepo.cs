using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class FriendshipRepo(ChatDatabaseContext context) : IFriendshipRepo {
    
    public Task<Friendship[]> GetFriendships(string userId) {
        return context.Friendships
            .Where(f => f.User1Id == userId || f.User2Id == userId)
            .ToArrayAsync();
    }

    public Task<Friendship?> GetFriendship(string user1Id, string user2Id) {
        return context.Friendships
            .FirstOrDefaultAsync(f => (f.User1Id == user1Id && f.User2Id == user2Id) ||
                                      (f.User1Id == user2Id && f.User2Id == user1Id));
    }

    public Task AddFriendship(Friendship friendship) {
        context.Friendships.Add(friendship);
        return context.SaveChangesAsync();
    }

    public Task RemoveFriendship(long id) {
        Friendship? friendship = context.Friendships.Find(id);
        if (friendship == null) {
            return Task.CompletedTask;
        }

        context.Friendships.Remove(friendship);
        return context.SaveChangesAsync();
    }

    public Task ModifyFriendship(Friendship friendship) {
        context.Entry(friendship).State = EntityState.Modified;
        return context.SaveChangesAsync();
    }

    public async Task<bool> IsFriendsWith(string userId, string[] userIds) {
        // check that there is a friendship between userId and ALL of the userIds
        return await context.Friendships
            .Where(f => (f.User1Id == userId && userIds.Contains(f.User2Id)) ||
                        (f.User2Id == userId && userIds.Contains(f.User1Id)))
            .GroupBy(f => f.User1Id == userId ? f.User2Id : f.User1Id)
            .CountAsync() == userIds.Length;
    }
}
