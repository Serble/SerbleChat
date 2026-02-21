using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GuildChannel {
    [Key, ForeignKey(nameof(ChannelNavigation))]
    public int ChannelId { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public int GuildId { get; set; }
    
    public int Index { get; set; }
    
    // Navigation Properties
    [JsonPropertyName("channel")]
    public Channel ChannelNavigation { get; set; } = null!;
    [JsonIgnore]
    public Guild GuildNavigation { get; set; } = null!;
}
