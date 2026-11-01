using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Schemas;

/// <summary>
/// A poll as sent to clients. Votes are public, so every option lists who picked it
/// and the same payload can be broadcast to everyone in the channel.
/// </summary>
public record PollResponse(
    long Id,
    long MessageId,
    long ChannelId,
    string AuthorId,
    string Question,
    bool AllowMultiple,
    DateTime CreatedAt,
    DateTime? ExpiresAt,
    DateTime? ClosedAt,
    PollOptionResponse[] Options
) {
    public static PollResponse FromPoll(Poll poll) {
        return new PollResponse(
            poll.Id, poll.MessageId, poll.ChannelId, poll.AuthorId, poll.Question, poll.AllowMultiple,
            poll.CreatedAt, poll.ExpiresAt, poll.ClosedAt,
            poll.Options
                .OrderBy(o => o.Index)
                .Select(o => new PollOptionResponse(
                    o.Id,
                    o.Text,
                    poll.Votes
                        .Where(v => v.OptionId == o.Id)
                        .OrderBy(v => v.CreatedAt)
                        .Select(v => v.UserId)
                        .ToArray()))
                .ToArray());
    }
}

public record PollOptionResponse(long Id, string Text, string[] VoterIds);
