using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IChannelRepo {
    Task<Channel?> GetChannel(int id);
    Task CreateChannel(Channel channel);
    Task UpdateChannel(Channel channel);
    Task DeleteChannel(int id);
}
