using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class ImageVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "AvatarVersion",
                table: "Users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "IconVersion",
                table: "Guilds",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "IconVersion",
                table: "Channels",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            // Rows from before versions existed may or may not have an image in S3: mark them unknown, and
            // ImageVersionBackfill looks each one up on startup. New rows start at 0 (no image).
            migrationBuilder.Sql("UPDATE Users SET AvatarVersion = -1");
            migrationBuilder.Sql("UPDATE Guilds SET IconVersion = -1");
            migrationBuilder.Sql("UPDATE Channels SET IconVersion = -1");

            // Unread counts now count a channel with no read marker from its start (before, such channels counted
            // as fully read). Guild members always had every guild channel without one, so give existing members a
            // marker at each channel's newest message: their counts stay what they were. DMs and group chats are left
            // alone on purpose: one never opened really is unread. Joining from now on sets markers (UnreadsRepo).
            migrationBuilder.Sql("""
                INSERT INTO ChannelReads (ChannelId, UserId, LastReadMessageId)
                SELECT c.Id, gm.UserId, latest.MaxId
                FROM Channels c
                JOIN GuildMembers gm ON gm.GuildId = c.GuildId
                JOIN (SELECT ChannelId, MAX(Id) AS MaxId FROM Messages GROUP BY ChannelId) latest ON latest.ChannelId = c.Id
                WHERE c.GuildId IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM ChannelReads cr WHERE cr.ChannelId = c.Id AND cr.UserId = gm.UserId)
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AvatarVersion",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IconVersion",
                table: "Guilds");

            migrationBuilder.DropColumn(
                name: "IconVersion",
                table: "Channels");
        }
    }
}
