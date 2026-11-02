using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

public interface INotificationService {
    /// <summary>Queues notifications for a new message. Returns once the job is safely queued (in Redis).</summary>
    Task EnqueueMessageProcessing(Channel channel, Message message, IEnumerable<string> userMentions);

    /// <summary>Lets the user's native devices clear notifications for a channel they've read up to a message.</summary>
    Task EnqueueReadSync(string userId, long channelId, long messageId);

    /// <summary>A client got an in-app notification over the socket, so no push is needed for it.</summary>
    Task AckSocketNotification(string ackId);

    /// <summary>A device showed a pushed notification (at <paramref name="shownAt"/>, Unix ms by its clock). Only used for statistics.</summary>
    Task AckDeviceDelivery(string deliveryId, long? shownAt);
}
