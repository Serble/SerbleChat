using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

public interface INotificationService {
    void EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions);
    /// <summary>Lets the user's native devices clear notifications for a channel they've read up to a message.</summary>
    void EnqueueReadSync(string userId, long channelId, long messageId);
    Task<Func<Task>> DequeueWork(CancellationToken stop);
}
