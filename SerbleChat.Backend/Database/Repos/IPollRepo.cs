using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database.Repos;

public interface IPollRepo {
    /// <summary>Saves the message and its poll together, filling in both ids.</summary>
    Task CreatePoll(Message message, Poll poll);

    /// <summary>A poll with its options and votes loaded.</summary>
    Task<Poll?> GetPoll(long pollId);

    Task<bool> MessageHasPoll(long messageId);

    /// <summary>Fills in <see cref="Message.Poll"/> on each message that has one.</summary>
    Task AttachPolls(IReadOnlyCollection<Message> messages);

    /// <summary>Polls in the channel that are still taking votes, newest first.</summary>
    Task<List<Poll>> GetActivePolls(long channelId, DateTime now);

    /// <summary>Replaces all of a user's votes in a poll with votes for <paramref name="optionIds"/>.</summary>
    Task SetVotes(long pollId, string userId, IReadOnlyCollection<long> optionIds);

    Task ClosePoll(long pollId, DateTime closedAt);
}
