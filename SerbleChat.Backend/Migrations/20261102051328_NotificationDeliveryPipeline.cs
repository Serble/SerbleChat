using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class NotificationDeliveryPipeline : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ConsecutiveFailures",
                table: "UserWebNotificationHooks",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "LastError",
                table: "UserWebNotificationHooks",
                type: "varchar(255)",
                maxLength: 255,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<DateTime>(
                name: "LastFailureAt",
                table: "UserWebNotificationHooks",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSeenAt",
                table: "UserWebNotificationHooks",
                type: "datetime(6)",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "LastSuccessAt",
                table: "UserWebNotificationHooks",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UrlHash",
                table: "UserWebNotificationHooks",
                type: "varchar(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateTable(
                name: "NotificationDeliveries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    Purpose = table.Column<int>(type: "int", nullable: false),
                    Transport = table.Column<int>(type: "int", nullable: false),
                    Outcome = table.Column<int>(type: "int", nullable: false),
                    HighPriority = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    UserId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ChannelId = table.Column<long>(type: "bigint", nullable: true),
                    MessageId = table.Column<long>(type: "bigint", nullable: true),
                    Host = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    SubscriptionId = table.Column<long>(type: "bigint", nullable: true),
                    MessageCreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    FirstAttemptAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    CompletedAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    StatusCode = table.Column<int>(type: "int", nullable: true),
                    Error = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    QueueMs = table.Column<int>(type: "int", nullable: true),
                    PushServiceMs = table.Column<int>(type: "int", nullable: true),
                    AcceptedMs = table.Column<int>(type: "int", nullable: true),
                    DeviceAckAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    DeviceAckMs = table.Column<int>(type: "int", nullable: true),
                    DeviceShownMs = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationDeliveries", x => x.Id);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            // Existing rows: hash their URLs (MySQL's SHA2 gives the same lowercase hex as HashUrl), count them as seen
            // now so the stale-endpoint cleanup gives their clients time to re-register, and drop the duplicates that
            // racing registrations left behind, keeping the oldest row, before the unique index goes on.
            migrationBuilder.Sql("UPDATE UserWebNotificationHooks SET UrlHash = SHA2(Url, 256), LastSeenAt = UTC_TIMESTAMP(6);");
            migrationBuilder.Sql("""
                DELETE newer FROM UserWebNotificationHooks newer
                JOIN UserWebNotificationHooks older ON older.UrlHash = newer.UrlHash AND older.Id < newer.Id;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_UserWebNotificationHooks_LastSeenAt",
                table: "UserWebNotificationHooks",
                column: "LastSeenAt");

            migrationBuilder.CreateIndex(
                name: "IX_UserWebNotificationHooks_UrlHash",
                table: "UserWebNotificationHooks",
                column: "UrlHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_CreatedAt",
                table: "NotificationDeliveries",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_Host_CreatedAt",
                table: "NotificationDeliveries",
                columns: new[] { "Host", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_NotificationDeliveries_UserId_CreatedAt",
                table: "NotificationDeliveries",
                columns: new[] { "UserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotificationDeliveries");

            migrationBuilder.DropIndex(
                name: "IX_UserWebNotificationHooks_LastSeenAt",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropIndex(
                name: "IX_UserWebNotificationHooks_UrlHash",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "ConsecutiveFailures",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "LastError",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "LastFailureAt",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "LastSeenAt",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "LastSuccessAt",
                table: "UserWebNotificationHooks");

            migrationBuilder.DropColumn(
                name: "UrlHash",
                table: "UserWebNotificationHooks");
        }
    }
}
