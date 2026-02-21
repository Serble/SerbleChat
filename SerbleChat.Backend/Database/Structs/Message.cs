using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class Message {
    [Key]
    public int Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    public int ChannelId { get; set; }
    
    public DateTime CreatedAt { get; set; }
    
    [ForeignKey(nameof(AuthorNavigation)), StringLength(64)]
    public string AuthorId { get; set; } = null!;
    
    [StringLength(16384)]
    public string Content { get; set; } = null!;
    
    // Navigation Properties
    [JsonIgnore]
    public ChatUser AuthorNavigation { get; set; } = null!;
    [JsonIgnore]
    public Channel ChannelNavigation { get; set; } = null!;
}
