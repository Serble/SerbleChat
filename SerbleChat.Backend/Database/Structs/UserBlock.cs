using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class UserBlock {
    [Key]
    public int Id { get; set; }
    
    [StringLength(64), ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [StringLength(64), ForeignKey(nameof(BlockedUserNavigation))]
    public string BlockedUserId { get; set; } = null!;
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    public ChatUser BlockedUserNavigation { get; set; } = null!;
}
