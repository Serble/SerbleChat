using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos;

public interface IGuildRepo {
    Task<Guild?> GetGuild(int id);
    Task<Guild[]> GetGuildsForUser(string userId);
    Task CreateGuild(Guild guild);
    Task DeleteGuild(int id);
    Task UpdateGuild(Guild guild);
    Task AddGuildMember(int guildId, string userId);
    Task<bool> IsGuildMember(int guildId, string userId);
    Task<ChatUser[]> GetGuildMembers(int guildId);
    
    Task<GuildChannel?> GetGuildChannel(int channelId);
    Task CreateGuildChannel(GuildChannel channel);
    Task DeleteGuildChannel(int id);
    Task UpdateGuildChannel(GuildChannel channel);
    Task<GuildChannel[]> GetGuildChannels(int guildId);
    Task<Channel[]> GetGuildChannelsAsChannels(int guildId);
    Task<ChatUser[]> GetGuildChannelMembers(int channelId);
    Task<GuildMemberResponse[]> GetGuildChannelMembersDetails(int channelId);
    
    Task CreateInvite(GuildInvite invite);
    Task<GuildInvite?> GetInvite(int id);
    Task DeleteInvite(int id);
    Task<GuildInvite[]> GetGuildInvites(int guildId);
}
