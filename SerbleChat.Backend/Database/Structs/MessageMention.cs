using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class MessageMention {
    [Key]
    public long Id { get; set; }
    
    [ForeignKey(nameof(MessageNavigation))]
    public long MessageId { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    // Navigation Properties
    public Message MessageNavigation { get; set; } = null!;
    public ChatUser UserNavigation { get; set; } = null!;
}
