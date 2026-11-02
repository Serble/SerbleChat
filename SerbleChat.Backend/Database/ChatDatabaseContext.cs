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
    public DbSet<UserNtfySubscription> UserNtfySubscriptions { get; set; } = null!;
    public DbSet<GuildBan> GuildBans { get; set; } = null!;
    public DbSet<Poll> Polls { get; set; } = null!;
    public DbSet<PollOption> PollOptions { get; set; } = null!;
    public DbSet<PollVote> PollVotes { get; set; } = null!;
    public DbSet<Webhook> Webhooks { get; set; } = null!;
    public DbSet<NotificationDelivery> NotificationDeliveries { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Message>()
            .HasIndex(e => e.ChannelId);

        modelBuilder.Entity<Message>()
            .HasIndex(e => e.CreatedAt);
        
        modelBuilder.Entity<GroupChatMember>()
            .HasIndex(e => new { e.GroupChatId, e.UserId })
            .IsUnique();

        // one row per endpoint, even when a client registers it twice at once
        modelBuilder.Entity<UserWebNotificationHook>()
            .HasIndex(e => e.UrlHash)
            .IsUnique();

        modelBuilder.Entity<UserWebNotificationHook>()
            .HasIndex(e => e.LastSeenAt);
        
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
        
        modelBuilder.Entity<GuildBan>()
            .HasIndex(e => new { e.UserId, e.GuildId })
            .IsUnique();
        
        modelBuilder.Entity<ChannelPermissionOverride>()
            .HasOne(cpo => cpo.RoleNavigation)
            .WithMany()
            .HasForeignKey(cpo => cpo.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ChannelPermissionOverride>()
            .HasOne(cpo => cpo.UserNavigation)
            .WithMany()
            .HasForeignKey(cpo => cpo.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        
        // A message has at most one poll, and deleting the message deletes it
        modelBuilder.Entity<Poll>()
            .HasOne(p => p.MessageNavigation)
            .WithOne()
            .HasForeignKey<Poll>(p => p.MessageId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Poll>()
            .HasIndex(p => p.ChannelId);

        modelBuilder.Entity<Poll>()
            .HasMany(p => p.Options)
            .WithOne(o => o.PollNavigation)
            .HasForeignKey(o => o.PollId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Poll>()
            .HasMany(p => p.Votes)
            .WithOne(v => v.PollNavigation)
            .HasForeignKey(v => v.PollId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PollVote>()
            .HasOne(v => v.OptionNavigation)
            .WithMany()
            .HasForeignKey(v => v.OptionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PollVote>()
            .HasIndex(v => new { v.OptionId, v.UserId })
            .IsUnique();

        modelBuilder.Entity<PollVote>()
            .HasIndex(v => new { v.PollId, v.UserId });

        modelBuilder.Entity<Webhook>()
            .HasOne(w => w.GuildNavigation)
            .WithMany()
            .HasForeignKey(w => w.GuildId)
            .OnDelete(DeleteBehavior.Cascade);

        // Deleting the channel leaves the webhook (and its URL) alive, just unassigned
        modelBuilder.Entity<Webhook>()
            .HasOne(w => w.ChannelNavigation)
            .WithMany()
            .HasForeignKey(w => w.ChannelId)
            .OnDelete(DeleteBehavior.SetNull);

        // Webhook messages have no author, but user messages still go when their author does
        modelBuilder.Entity<Message>()
            .HasOne(m => m.AuthorNavigation)
            .WithMany()
            .HasForeignKey(m => m.AuthorId)
            .OnDelete(DeleteBehavior.Cascade);

        // Messages outlive their webhook; they keep the copied name
        modelBuilder.Entity<Message>()
            .HasOne(m => m.WebhookNavigation)
            .WithMany()
            .HasForeignKey(m => m.WebhookId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<Channel>()
            .HasOne(c => c.GuildNavigation)
            .WithMany()
            .HasForeignKey(c => c.GuildId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
