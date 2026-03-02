using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class GuildBan {
    [Key]
    public long Id { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public long GuildId { get; set; }
    
    [ForeignKey(nameof(UserNavigation)), StringLength(64)]
    public string UserId { get; set; } = null!;
    
    public DateTime CreatedAt { get; set; }
    
    public DateTime Until { get; set; }
    
    // Navigation properties
    public Guild GuildNavigation { get; set; } = null!;
    public ChatUser UserNavigation { get; set; } = null!;
}
