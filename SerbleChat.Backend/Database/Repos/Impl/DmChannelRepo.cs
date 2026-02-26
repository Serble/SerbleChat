using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class DmChannelRepo(ChatDatabaseContext context) : IDmChannelRepo {
    
    /// <summary>
    /// Get all DM channels the user is in and include the channel info.
    /// Also order by the most recent message in the channel, so that the most recently active channels are first.
    /// </summary>
    /// <param name="userId"></param>
    /// <returns></returns>
    public async Task<List<DmChannel>> GetDmChannels(string userId) {
        // Get DM channels with the time of their latest message
        List<DmChannel> dmChannels = await context.DmChannels
            .Where(dm => dm.User1Id == userId || dm.User2Id == userId)
            .Include(dm => dm.ChannelNavigation)
            .Select(dm => new {
                Channel = dm,
                LastMessage = context.Messages
                    .Where(m => m.ChannelId == dm.ChannelId)
                    .OrderByDescending(m => m.CreatedAt)
                    .Select(m => m.CreatedAt)
                    .FirstOrDefault()
            })
            .OrderByDescending(x => x.LastMessage)
            .Select(x => x.Channel)
            .ToListAsync();

        return dmChannels;
    }

    public async Task<DmChannel?> GetDmChannel(string user1Id, string user2Id) {
        return await context.DmChannels
            .Where(dm =>
                (dm.User1Id == user1Id && dm.User2Id == user2Id) 
                || (dm.User1Id == user2Id && dm.User2Id == user1Id)
            ).Include(dm => dm.ChannelNavigation)
            .FirstOrDefaultAsync();
    }

    public async Task<DmChannel?> GetDmChannel(long channelId) {
        return await context.DmChannels
            .Where(dm => dm.ChannelId == channelId)
            .Include(dm => dm.ChannelNavigation)
            .Include(dm => dm.User1Navigation)
            .Include(dm => dm.User2Navigation)
            .FirstOrDefaultAsync();
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
