using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class PollOption {
    [Key]
    public long Id { get; set; }

    [ForeignKey(nameof(PollNavigation))]
    public long PollId { get; set; }

    /// <summary>Display order within the poll.</summary>
    public int Index { get; set; }

    [StringLength(PollLimits.OptionMaxLength)]
    public string Text { get; set; } = null!;

    // Navigation Properties
    public Poll PollNavigation { get; set; } = null!;
}
