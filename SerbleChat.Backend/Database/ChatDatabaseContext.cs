using Microsoft.EntityFrameworkCore;

namespace SerbleChat.Backend.Database;

public class ChatDatabaseContext : DbContext {
    public DbSet<Structs.ChatUser> Users { get; set; } = null!;
    
    public ChatDatabaseContext(DbContextOptions<ChatDatabaseContext> options) : base(options) { }
}
