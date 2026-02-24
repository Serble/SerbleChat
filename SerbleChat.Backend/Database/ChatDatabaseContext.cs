using Microsoft.EntityFrameworkCore;
using SerbleChat.Backend.Database.Structs;

namespace SerbleChat.Backend.Database;

public class ChatDatabaseContext(DbContextOptions<ChatDatabaseContext> options) : DbContext(options) {
    public DbSet<ChatUser> Users { get; set; } = null!;
    public DbSet<Guild> Guilds { get; set; } = null!;
    public DbSet<GroupChat> GroupChats { get; set; } = null!;
    public DbSet<Channel> Channels { get; set; } = null!;
    public DbSet<GroupChatMember> GroupChatMembers { get; set; } = null!;
    public DbSet<Message> Messages { get; set; } = null!;
    public DbSet<Friendship> Friendships { get; set; } = null!;
    public DbSet<DmChannel> DmChannels { get; set; } = null!;
    public DbSet<GuildMember> GuildMembers { get; set; } = null!;
    public DbSet<GuildChannel> GuildChannels { get; set; } = null!;
    public DbSet<GuildInvite> GuildInvites { get; set; } = null!;
    public DbSet<Role> Roles { get; set; } = null!;
    public DbSet<UserRoleAssignment> UserRoleAssignments { get; set; } = null!;
    public DbSet<ChannelPermissionOverride> ChannelPermissionOverrides { get; set; } = null!;
    public DbSet<UserBlock> UserBlocks { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<GroupChatMember>()
            .HasIndex(e => new { e.GroupChatId, e.UserId })
            .IsUnique();
        
        modelBuilder.Entity<UserRoleAssignment>()
            .HasIndex(e => new { e.UserId, e.RoleId })
            .IsUnique();
        
        modelBuilder.Entity<UserBlock>()
            .HasIndex(e => new { e.UserId, e.BlockedUserId })
            .IsUnique();
    }
}
