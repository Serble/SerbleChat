using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class DmChannelRepo(ChatDatabaseContext context) : IDmChannelRepo {
    
    public Task<List<DmChannel>> GetDmChannels(string userId) {
        return context.DmChannels
            .Where(dm => dm.User1Id == userId || dm.User2Id == userId)
            .ToListAsync();
    }

    public async Task<DmChannel?> GetDmChannel(string user1Id, string user2Id) {
        return await context.DmChannels
            .FirstOrDefaultAsync(dm =>
                (dm.User1Id == user1Id && dm.User2Id == user2Id) 
                || (dm.User1Id == user2Id && dm.User2Id == user1Id)
            );
    }

    public async Task<DmChannel?> GetDmChannel(int channelId) {
        return await context.DmChannels.FindAsync(channelId);
    }

    public async Task CreateDmChannel(DmChannel channel) {
        context.DmChannels.Add(channel);
        await context.SaveChangesAsync();
    }

    public async Task UpdateDmChannel(DmChannel channel) {
        context.DmChannels.Update(channel);
        await context.SaveChangesAsync();
    }

    public async Task DeleteDmChannel(string id) {
        DmChannel? channel = await context.DmChannels.FindAsync(id);
        if (channel == null) {
            return;
        }

        context.DmChannels.Remove(channel);
        await context.SaveChangesAsync();
    }
}
