using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GuildInvite {
    [Key]
    public int Id { get; set; }
    
    [ForeignKey(nameof(GuildNavigation))]
    public int GuildId { get; set; }
    
    // Navigation Properties
    [JsonIgnore]
    public Guild GuildNavigation { get; set; } = null!;
}
