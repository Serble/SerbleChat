using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GuildInvite {
    [Key, StringLength(12)]
    public string Id { get; set; } = null!;
    
    [ForeignKey(nameof(GuildNavigation))]
    public long GuildId { get; set; }
    
    // Navigation Properties
    [JsonIgnore]
    public Guild GuildNavigation { get; set; } = null!;
}
