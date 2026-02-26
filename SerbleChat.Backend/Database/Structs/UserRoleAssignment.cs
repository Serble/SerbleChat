using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class UserRoleAssignment {
    [Key]
    public long Id { get; set; }

    [StringLength(64)]
    [ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(RoleNavigation))]
    public long RoleId { get; set; }
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    public Role RoleNavigation { get; set; } = null!;
}
