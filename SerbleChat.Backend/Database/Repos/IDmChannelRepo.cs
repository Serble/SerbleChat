using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IDmChannelRepo {
    Task<List<DmChannel>> GetDmChannels(string userId);
    Task<DmChannel?> GetDmChannel(string user1Id, string user2Id);
    Task<DmChannel?> GetDmChannel(long channelId);
    Task CreateDmChannel(DmChannel channel);
    Task UpdateDmChannel(DmChannel channel);
    Task DeleteDmChannel(string id);
}
