using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class GuildChannel {
    [Key]
    public int Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    public int ChannelId { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public int GuildId { get; set; }
    
    public int Index { get; set; }
    
    // Navigation Properties
    public Channel ChannelNavigation { get; set; } = null!;
    public Guild GuildNavigation { get; set; } = null!;
}
