using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using Newtonsoft.Json;
using ApiJsonIgnore = System.Text.Json.Serialization.JsonIgnoreAttribute;

namespace SerbleChat.Backend.Database.Structs;

public class Channel {
    [Key]
    [JsonProperty(PropertyName = "id")]
    public long Id { get; set; }
    
    [JsonProperty(PropertyName = "created_at")]
    public DateTime CreatedAt { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    [JsonProperty(PropertyName = "guild_id")]
    public long? GuildId { get; set; }
    
    [JsonProperty(PropertyName = "type")]
    public ChannelType Type { get; set; }
    
    [StringLength(64)]
    [JsonProperty(PropertyName = "name")]
    public string Name { get; set; } = null!;
    
    [JsonProperty(PropertyName = "voice_capable")]
    public bool VoiceCapable { get; set; }

    /// <summary>
    /// Changes whenever the channel's icon (guild channels and group chats) does. 0 means none, -1 not known yet
    /// (see <see cref="ChatUser.AvatarVersion"/>).
    /// </summary>
    [JsonProperty(PropertyName = "icon_version")]
    public long IconVersion { get; set; }
    
    // Navigation Properties
    [ApiJsonIgnore]
    [JsonProperty(PropertyName = "guild")]
    public Guild GuildNavigation = null!;
}

public enum ChannelType {
    Guild,
    Dm,
    Group
}
