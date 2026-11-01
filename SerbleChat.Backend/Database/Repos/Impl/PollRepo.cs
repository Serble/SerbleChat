using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;
using SerbleChat.Backend.Schemas;

namespace SerbleChat.Backend.Database.Repos.Impl;

public class PollRepo(ChatDatabaseContext context) : IPollRepo {

    public Task CreatePoll(Message message, Poll poll) {
        poll.MessageNavigation = message;
        context.Messages.Add(message);
        context.Polls.Add(poll);
        return context.SaveChangesAsync();  // one SaveChanges, so one transaction
    }

    public Task<Poll?> GetPoll(long pollId) {
        return context.Polls
            .AsNoTracking()
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .AsSplitQuery()
            .FirstOrDefaultAsync(p => p.Id == pollId);
    }

    public Task<bool> MessageHasPoll(long messageId) {
        return context.Polls.AnyAsync(p => p.MessageId == messageId);
    }

    public async Task AttachPolls(IReadOnlyCollection<Message> messages) {
        if (messages.Count == 0) return;
        List<long> ids = messages.Select(m => m.Id).ToList();
        List<Poll> polls = await context.Polls
            .AsNoTracking()
            .Where(p => ids.Contains(p.MessageId))
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .AsSplitQuery()
            .ToListAsync();
        if (polls.Count == 0) return;

        Dictionary<long, Poll> byMessage = polls.ToDictionary(p => p.MessageId);
        foreach (Message message in messages) {
            if (byMessage.TryGetValue(message.Id, out Poll? poll)) {
                message.Poll = PollResponse.FromPoll(poll);
            }
        }
    }

    public Task<List<Poll>> GetActivePolls(long channelId, DateTime now) {
        return context.Polls
            .AsNoTracking()
            .Where(p => p.ChannelId == channelId && p.ClosedAt == null && (p.ExpiresAt == null || p.ExpiresAt > now))
            .OrderByDescending(p => p.CreatedAt)
            .Include(p => p.Options)
            .Include(p => p.Votes)
            .AsSplitQuery()
            .ToListAsync();
    }

    public async Task SetVotes(long pollId, string userId, IReadOnlyCollection<long> optionIds) {
        await using var tx = await context.Database.BeginTransactionAsync();
        await context.PollVotes
            .Where(v => v.PollId == pollId && v.UserId == userId)
            .ExecuteDeleteAsync();
        DateTime now = DateTime.UtcNow;
        foreach (long optionId in optionIds) {
            context.PollVotes.Add(new PollVote {
                PollId = pollId,
                OptionId = optionId,
                UserId = userId,
                CreatedAt = now
            });
        }
        await context.SaveChangesAsync();
        await tx.CommitAsync();
    }

    public Task ClosePoll(long pollId, DateTime closedAt) {
        return context.Polls
            .Where(p => p.Id == pollId && p.ClosedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(p => p.ClosedAt, closedAt));
    }
}
