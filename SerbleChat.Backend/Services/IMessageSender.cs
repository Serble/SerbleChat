using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Services;

/// <summary>
/// Everything that happens when a message is posted: saving it, pushing it to clients,
/// recording mentions and queueing notifications. Shared by users, polls and webhooks.
/// </summary>
public interface IMessageSender {
    /// <summary>Saves <paramref name="message"/> (filling in its id) and delivers it.</summary>
    Task Send(Channel channel, Message message);

    /// <summary>Delivers a message that is already saved.</summary>
    /// <param name="parseMentions">Whether <c>&lt;@user:…&gt;</c> in the content pings people.</param>
    Task Deliver(Channel channel, Message message, bool parseMentions = true);
}
