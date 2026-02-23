using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class ChannelRepo(ChatDatabaseContext context) : IChannelRepo {
    
    public async Task<Channel?> GetChannel(int id) {
        return await context.Channels.FindAsync(id);
    }

    public async Task CreateChannel(Channel channel) {
        context.Channels.Add(channel);
        await context.SaveChangesAsync();
    }

    public async Task UpdateChannel(Channel channel) {
        context.Channels.Update(channel);
        await context.SaveChangesAsync();
    }

    public async Task DeleteChannel(int id) {
        Channel? channel = await GetChannel(id);
        if (channel == null) {
            return;
        }

        context.Channels.Remove(channel);
        await context.SaveChangesAsync();
    }

    // will need to collect:
    // - all DMs the user is in
    // - all group chats the user is in
    // - all channels in guilds the user is in
    public async Task<List<Channel>> GetChannelsVisibleToUser(string userId) {
        List<Channel> channels = [];

        channels.AddRange(await context.DmChannels
            .Where(dm => dm.User1Id == userId || dm.User2Id == userId)
            .Select(dm => dm.ChannelNavigation)
            .ToListAsync());

        channels.AddRange(await context.GroupChatMembers
            .Where(g => g.UserId == userId)
            .Select(g => g.GroupChatNavigation.ChannelNavigation)
            .ToListAsync());

        channels.AddRange(await context.GuildMembers
            .Where(m => m.UserId == userId)
            .SelectMany(m => context.GuildChannels
                .Where(gc => gc.GuildId == m.GuildId)
                .Select(gc => gc.ChannelNavigation))
            .ToListAsync());

        return channels;
    }
}
