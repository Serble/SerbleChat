using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class ChannelRead {
    [Key]
    public long Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    public long ChannelId { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    public long LastReadMessageId { get; set; }
    
    // Navigation Properties
    public Channel ChannelNavigation { get; set; } = null!;
    public ChatUser UserNavigation { get; set; } = null!;
}
