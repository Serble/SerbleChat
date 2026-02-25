using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class ChannelRepo(ChatDatabaseContext context, IGroupChatRepo groups, IDmChannelRepo dms, IUserRepo users, 
    IGuildRepo guilds) : IChannelRepo {
    
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
    
    public async Task<bool> UserHasAccessToChannel(string userId, Channel channel, bool sendMessages) {
        switch (channel.Type) {
            case ChannelType.Group:
                return await groups.IsMemberInChat(channel.Id, userId);
            
            case ChannelType.Dm: {
                DmChannel? dmChannel = await dms.GetDmChannel(channel.Id);
                if (dmChannel == null) {
                    return false;
                }

                if (!(dmChannel.User1Id == userId || dmChannel.User2Id == userId)) {
                    return false;
                }

                if (sendMessages) {
                    bool blocked = await users.AreUsersBlocked(dmChannel.User1Id, dmChannel.User2Id);
                    if (blocked) {
                        return false;
                    }
                }
                
                return true;
            }

            case ChannelType.Guild: {
                if (!channel.GuildId.HasValue) {
                    return false;
                }

                if (!await guilds.IsGuildMember(channel.GuildId.Value, userId)) {
                    return false;
                }

                GuildPermissions perms = await guilds.GetUserPermissions(userId, channel.GuildId.Value, channel.Id);
                if (!perms.HasPerm(p => p.ViewChannel)) {
                    return false;
                }
                
                if (sendMessages && !perms.HasPerm(p => p.SendMessages)) {
                    return false;
                }
                
                return true;
            }
            
            default:
                return false;
        }
    }

    public async Task<IEnumerable<ChatUser>> GetChannelMembers(Channel channel) {
        switch (channel.Type) {
            case ChannelType.Guild: {
                return await guilds.GetGuildChannelMembers(channel.Id);
            }

            case ChannelType.Dm: {
                DmChannel? dm = await dms.GetDmChannel(channel.Id);
                if (dm == null) {
                    throw new Exception("DM channel not found");
                }

                return [dm.User1Navigation, dm.User2Navigation];
            }

            case ChannelType.Group: {
                return (await groups.GetMembers(channel.Id))
                    .Select(m => m.UserNavigation);
            }
            
            default:
                throw new ArgumentOutOfRangeException(nameof(channel));
        }
    }
}
