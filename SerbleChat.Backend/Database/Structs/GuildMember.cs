using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GuildMember {
    [Key, JsonIgnore]
    public int Id { get; set; }
    
    [ForeignKey(nameof(UserNavigation)), StringLength(64)]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(GuildNavigation))]
    public int GuildId { get; set; }
    
    // Navigation Properties
    [JsonIgnore]
    public Guild GuildNavigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser UserNavigation { get; set; } = null!;
}
