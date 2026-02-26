using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class DmChannel {
    [Key, ForeignKey(nameof(ChannelNavigation))]
    public long ChannelId { get; set; }
    
    [ForeignKey(nameof(User1Navigation)), StringLength(64)]
    public string User1Id { get; set; } = null!;
    
    [ForeignKey(nameof(User2Navigation)), StringLength(64)]
    public string User2Id { get; set; } = null!;
    
    // Navigation Properties
    [JsonPropertyName("channel")]
    public Channel ChannelNavigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser User1Navigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser User2Navigation { get; set; } = null!;
}
