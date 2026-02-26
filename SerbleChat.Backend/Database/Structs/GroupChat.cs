using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GroupChat {
    [Key, ForeignKey(nameof(ChannelNavigation))]
    public long ChannelId { get; set; }

    [ForeignKey(nameof(OwnerNavigation)), StringLength(64)]
    public string OwnerId { get; set; } = null!;
    
    // Navigational Properties
    [JsonPropertyName("channel")]
    public Channel ChannelNavigation { get; set; } = null!;

    [JsonIgnore]
    public ChatUser OwnerNavigation { get; set; } = null!;
}