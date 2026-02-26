using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IMessageRepo {
    Task<List<Message>> GetMessages(long channelId, int limit = 50, int offset = 0);
    Task<Message?> GetMessage(long id);
    Task CreateMessage(Message message);
    Task UpdateMessage(Message message);
    Task DeleteMessage(long id);
}
