using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos;

public interface IGuildRepo {
    Task<Guild?> GetGuild(long id);
    Task<Guild[]> GetGuildsForUser(string userId);
    Task CreateGuild(Guild guild);
    Task DeleteGuild(long id);
    Task UpdateGuild(Guild guild);
    Task AddGuildMember(long guildId, string userId);
    Task<bool> IsGuildMember(long guildId, string userId);
    Task<ChatUser[]> GetGuildMembers(long guildId);
    
    Task<GuildChannel?> GetGuildChannel(long channelId);
    Task CreateGuildChannel(GuildChannel channel);
    Task DeleteGuildChannel(long id);
    Task UpdateGuildChannel(GuildChannel channel);
    Task<GuildChannel[]> GetGuildChannels(long guildId);
    Task<Channel[]> GetGuildChannelsAsChannels(long guildId);
    Task<ChatUser[]> GetGuildChannelMembers(long channelId);
    Task<GuildMemberResponse[]> GetGuildChannelMembersDetails(long channelId);
    
    Task<ChannelPermissionOverride[]> GetChannelPermissionOverrides(long channelId);
    Task<ChannelPermissionOverride?> GetChannelPermissionOverride(long id);
    Task CreateChannelPermissionOverride(ChannelPermissionOverride permissionOverride);
    Task DeleteChannelPermissionOverride(long id);
    Task UpdateChannelPermissionOverride(ChannelPermissionOverride permissionOverride);
    
    Task CreateInvite(GuildInvite invite);
    Task<GuildInvite?> GetInvite(long id);
    Task DeleteInvite(long id);
    Task<GuildInvite[]> GetGuildInvites(long guildId);
    
    public Task<GuildPermissions> GetUserPermissions(string userId, long guildId, long channelId = -1);
    public Task<Dictionary<long, GuildPermissions>> GetUserPermissionsForGuild(string userId, long guildId);
}
