using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

/// <summary>
/// A poll attached to a message. The message carries it through history, deletion
/// and notifications; this holds the question, options and votes.
/// </summary>
public class Poll {
    [Key]
    public long Id { get; set; }

    [ForeignKey(nameof(MessageNavigation))]
    public long MessageId { get; set; }

    /// <summary>Copied from the message so active polls can be found without a join.</summary>
    public long ChannelId { get; set; }

    [StringLength(64)]
    public string AuthorId { get; set; } = null!;

    [StringLength(PollLimits.QuestionMaxLength)]
    public string Question { get; set; } = null!;

    public bool AllowMultiple { get; set; }

    public DateTime CreatedAt { get; set; }

    /// <summary>When voting stops on its own. Null means it runs until someone ends it.</summary>
    public DateTime? ExpiresAt { get; set; }

    /// <summary>Set when someone ends the poll early.</summary>
    public DateTime? ClosedAt { get; set; }

    // Navigation Properties
    public Message MessageNavigation { get; set; } = null!;
    public List<PollOption> Options { get; set; } = [];
    public List<PollVote> Votes { get; set; } = [];

    public bool IsEnded(DateTime now) => ClosedAt != null || (ExpiresAt != null && ExpiresAt <= now);
}

public static class PollLimits {
    public const int QuestionMaxLength = 300;
    public const int OptionMaxLength = 100;
    public const int MinOptions = 2;
    public const int MaxOptions = 10;
    public static readonly TimeSpan MinDuration = TimeSpan.FromMinutes(1);
    public static readonly TimeSpan MaxDuration = TimeSpan.FromDays(30);
}
