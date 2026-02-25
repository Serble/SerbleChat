using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

public interface INotificationService {
    void EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions);
    Task<Func<Task>> DequeueWork(CancellationToken stop);
}
