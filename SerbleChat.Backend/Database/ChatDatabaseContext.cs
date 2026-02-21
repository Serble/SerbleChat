using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database;

public class ChatDatabaseContext(DbContextOptions<ChatDatabaseContext> options) : DbContext(options) {
    public DbSet<ChatUser> Users { get; set; } = null!;
    public DbSet<Guild> Guilds { get; set; } = null!;
    public DbSet<Channel> Channels { get; set; } = null!;
    public DbSet<GuildChannels> GuildChannels { get; set; } = null!;
    public DbSet<Message> Messages { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<GuildChannels>()
            .HasIndex(e => new { e.GuildId, e.Index })
            .IsUnique();
    }
}
