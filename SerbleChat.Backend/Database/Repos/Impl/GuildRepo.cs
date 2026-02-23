using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class GuildRepo(ChatDatabaseContext context) : IGuildRepo {
    
    public async Task<Guild?> GetGuild(int id) {
        return await context.Guilds.FindAsync(id);
    }

    public async Task<Guild[]> GetGuildsForUser(string userId) {
        return await context.GuildMembers.Where(m => m.UserId == userId)
            .Select(m => m.GuildNavigation)
            .ToArrayAsync();
    }

    public async Task CreateGuild(Guild guild) {
        context.Guilds.Add(guild);
        await context.SaveChangesAsync();
    }

    public Task DeleteGuild(int id) {
        return context.Guilds.Where(g => g.Id == id).ExecuteDeleteAsync();
    }

    public async Task UpdateGuild(Guild guild) {
        context.Guilds.Update(guild);
        await context.SaveChangesAsync();
    }

    public async Task AddGuildMember(int guildId, string userId) {
        bool exists = await context.GuildMembers
            .AnyAsync(m => m.GuildId == guildId && m.UserId == userId);
        if (exists) return;
        context.GuildMembers.Add(new GuildMember { GuildId = guildId, UserId = userId });
        await context.SaveChangesAsync();
    }

    public Task<bool> IsGuildMember(int guildId, string userId) {
        return context.GuildMembers
            .AnyAsync(m => m.GuildId == guildId && m.UserId == userId);
    }

    public Task<ChatUser[]> GetGuildMembers(int guildId) {
        return context.GuildMembers
            .Where(m => m.GuildId == guildId)
            .Select(m => m.UserNavigation)
            .ToArrayAsync();
    }

    public Task<GuildChannel?> GetGuildChannel(int channelId) {
        return context.GuildChannels
            .Where(c => c.ChannelId == channelId)
            .Include(c => c.ChannelNavigation)
            .FirstOrDefaultAsync();
    }

    public async Task CreateGuildChannel(GuildChannel channel) {
        context.GuildChannels.Add(channel);
        await context.SaveChangesAsync();
    }

    public Task DeleteGuildChannel(int id) {
        return context.GuildChannels.Where(c => c.ChannelId == id).ExecuteDeleteAsync();
    }

    public Task UpdateGuildChannel(GuildChannel channel) {
        context.GuildChannels.Update(channel);
        return context.SaveChangesAsync();
    }

    public Task<GuildChannel[]> GetGuildChannels(int guildId) {
        return context.GuildChannels
            .Where(c => c.GuildId == guildId)
            .Include(c => c.ChannelNavigation)
            .ToArrayAsync();
    }

    public Task<Channel[]> GetGuildChannelsAsChannels(int guildId) {
        return context.GuildChannels
            .Where(c => c.GuildId == guildId)
            .Select(c => c.ChannelNavigation)
            .ToArrayAsync();
    }

    public Task<ChatUser[]> GetGuildChannelMembers(int channelId) {
        // for now assume all guild members have access to all channels
        // we'll get the guild id from the channel, then get all members of that guild
        return context.GuildChannels
            .Where(c => c.ChannelId == channelId)
            .Select(c => c.GuildId)
            .Join(context.GuildMembers, guildId => guildId, m => m.GuildId, (guildId, m) => m.UserNavigation)
            .ToArrayAsync();
    }

    public Task CreateInvite(GuildInvite invite) {
        context.GuildInvites.Add(invite);
        return context.SaveChangesAsync();
    }

    public async Task<GuildInvite?> GetInvite(int id) {
        return await context.GuildInvites.FindAsync(id);
    }

    public Task DeleteInvite(int id) {
        return context.GuildInvites.Where(i => i.Id == id).ExecuteDeleteAsync();
    }

    public Task<GuildInvite[]> GetGuildInvites(int guildId) {
        return context.GuildInvites
            .Where(i => i.GuildId == guildId)
            .ToArrayAsync();
    }
}
