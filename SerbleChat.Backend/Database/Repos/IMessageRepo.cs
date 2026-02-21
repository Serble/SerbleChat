using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IMessageRepo {
    List<Message> GetMessages(string channelId, int limit = 50, int offset = 0);
    Message? GetMessage(string id);
    Task CreateMessage(Message message);
    Task UpdateMessage(Message message);
    Task DeleteMessage(string id);
}
