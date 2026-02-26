using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Newtonsoft.Json;
using ApiJsonIgnore = System.Text.Json.Serialization.JsonIgnoreAttribute;

namespace SerbleChat.Backend.Database.Structs;

// The newtonsoft json annotations are for notifications.
// The System.Text.Json annotations are for the API.
public class Message {
    [Key]
    [JsonProperty(PropertyName = "id")]
    public long Id { get; set; }
    
    [ForeignKey(nameof(ChannelNavigation))]
    [JsonProperty(PropertyName = "channel_id")]
    public long ChannelId { get; set; }
    
    [JsonProperty(PropertyName = "created_at")]
    public DateTime CreatedAt { get; set; }
    
    [ForeignKey(nameof(AuthorNavigation)), StringLength(64)]
    [JsonProperty(PropertyName = "author_id")]
    public string AuthorId { get; set; } = null!;
    
    [StringLength(16384)]
    [JsonProperty(PropertyName = "content")]
    public string Content { get; set; } = null!;
    
    // Navigation Properties
    [ApiJsonIgnore]
    [JsonProperty(PropertyName = "author")]
    public ChatUser AuthorNavigation { get; set; } = null!;
    [ApiJsonIgnore]
    [JsonProperty(PropertyName = "channel")]
    public Channel ChannelNavigation { get; set; } = null!;
}
