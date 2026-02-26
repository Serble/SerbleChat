using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace SerbleChat.Backend.Database.Structs;

public class GroupChatMember {
    [Key, JsonIgnore]
    public long Id { get; set; }
    
    [ForeignKey(nameof(UserNavigation)), StringLength(64)]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(GroupChatNavigation))]
    public long GroupChatId { get; set; }
    
    // Navigation Properties
    [JsonIgnore]
    public GroupChat GroupChatNavigation { get; set; } = null!;
    [JsonIgnore]
    public ChatUser UserNavigation { get; set; } = null!;
}
