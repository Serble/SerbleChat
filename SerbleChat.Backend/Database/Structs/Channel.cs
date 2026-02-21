using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class Channel {
    [Key]
    public int Id { get; set; }
    
    public DateTime CreatedAt { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public int? GuildId { get; set; }
    
    [StringLength(64)]
    public string Name { get; set; } = null!;
    
    public bool VoiceCapable { get; set; }
    
    // Navigation Properties
    public Guild GuildNavigation = null!;
}
