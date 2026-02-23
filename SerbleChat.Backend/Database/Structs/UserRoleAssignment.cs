using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class UserRoleAssignment {
    [Key]
    public int Id { get; set; }

    [StringLength(64)]
    [ForeignKey(nameof(UserNavigation))]
    public string UserId { get; set; } = null!;
    
    [ForeignKey(nameof(RoleNavigation))]
    public int RoleId { get; set; }
    
    // Navigation Properties
    public ChatUser UserNavigation { get; set; } = null!;
    public Role RoleNavigation { get; set; } = null!;
}
