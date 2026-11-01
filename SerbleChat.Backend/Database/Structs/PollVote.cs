using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

/// <summary>One user's vote for one option. A multiple-choice vote is several rows.</summary>
public class PollVote {
    [Key]
    public long Id { get; set; }

    [ForeignKey(nameof(PollNavigation))]
    public long PollId { get; set; }

    [ForeignKey(nameof(OptionNavigation))]
    public long OptionId { get; set; }

    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    // Navigation Properties
    public Poll PollNavigation { get; set; } = null!;
    public PollOption OptionNavigation { get; set; } = null!;
    public ChatUser UserNavigation { get; set; } = null!;
}
