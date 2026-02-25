using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IChannelRepo {
    Task<Channel?> GetChannel(int id);
    Task CreateChannel(Channel channel);
    Task UpdateChannel(Channel channel);
    Task DeleteChannel(int id);
    Task<List<Channel>> GetChannelsVisibleToUser(string userId);
    Task<bool> UserHasAccessToChannel(string userId, Channel channel, bool sendMessages);
    Task<IEnumerable<ChatUser>> GetChannelMembers(Channel channel);
}
