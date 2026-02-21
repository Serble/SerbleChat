using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class GroupChatMember {
    [ForeignKey(nameof(UserNavigation)), StringLength(64)]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(GroupChatNavigation))]
    public int GroupChatId { get; set; }
    
    // Navigation Properties
    public GroupChat GroupChatNavigation { get; set; } = null!;
    public ChatUser UserNavigation { get; set; } = null!;
}
