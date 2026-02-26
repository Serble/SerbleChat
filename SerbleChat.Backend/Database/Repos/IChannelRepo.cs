using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IChannelRepo {
    Task<Channel?> GetChannel(long id);
    Task CreateChannel(Channel channel);
    Task UpdateChannel(Channel channel);
    Task DeleteChannel(long id);
    Task<List<Channel>> GetChannelsVisibleToUser(string userId);
    Task<bool> UserHasAccessToChannel(string userId, Channel channel, bool sendMessages);
    Task<IEnumerable<ChatUser>> GetChannelMembers(Channel channel);
}
