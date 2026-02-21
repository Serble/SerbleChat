using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace SerbleChat.Backend.Database.Structs;

public class Guild {
    [Key]
    public int Id { get; set; }
    
    [StringLength(64)]
    public string Name { get; set; } = null!;

    [ForeignKey(nameof(OwnerNavigation))]
    [StringLength(64)]
    public string OwnerId { get; set; } = null!;
    
    // Navigation Properties
    public ChatUser OwnerNavigation { get; set; } = null!;
}