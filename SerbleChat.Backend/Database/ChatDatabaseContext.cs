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
    public DbSet<ClientOptionsData> ClientOptions { get; set; } = null!;
    public DbSet<UserChannelNotificationPreferences> UserChannelNotificationPreferences { get; set; } = null!;
    public DbSet<UserGuildNotificationPreferences> UserGuildNotificationPreferences { get; set; } = null!;
    public DbSet<MessageMention> MessageMentions { get; set; } = null!;
    public DbSet<ChannelRead> ChannelReads { get; set; } = null!;
    public DbSet<UserWebNotificationHook> UserWebNotificationHooks { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Message>()
            .HasIndex(e => e.ChannelId);

        modelBuilder.Entity<Message>()
            .HasIndex(e => e.CreatedAt);
        
        modelBuilder.Entity<GroupChatMember>()
            .HasIndex(e => new { e.GroupChatId, e.UserId })
            .IsUnique();
        
        modelBuilder.Entity<UserRoleAssignment>()
            .HasIndex(e => new { e.UserId, e.RoleId })
            .IsUnique();
        
        modelBuilder.Entity<UserBlock>()
            .HasIndex(e => new { e.UserId, e.BlockedUserId })
            .IsUnique();
        
        modelBuilder.Entity<UserChannelNotificationPreferences>()
            .HasIndex(e => new { e.UserId, e.ChannelId })
            .IsUnique();
        
        modelBuilder.Entity<UserGuildNotificationPreferences>()
            .HasIndex(e => new { e.UserId, e.GuildId })
            .IsUnique();

        modelBuilder.Entity<MessageMention>()
            .HasIndex(e => new { e.MessageId, e.UserId });
        
        modelBuilder.Entity<ChannelRead>()
            .HasIndex(e => new { e.UserId, e.ChannelId })
            .IsUnique();
    }
}
