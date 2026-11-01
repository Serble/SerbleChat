using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddWebhooks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Permissions_ManageWebhooks",
                table: "Roles",
                type: "int",
                nullable: false,
                defaultValue: 2);  // PermissionState.Inherit: existing roles leave it alone

            migrationBuilder.AlterColumn<string>(
                name: "AuthorId",
                table: "Messages",
                type: "varchar(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "varchar(64)",
                oldMaxLength: 64)
                .Annotation("MySql:CharSet", "utf8mb4")
                .OldAnnotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<string>(
                name: "WebhookAvatarUrl",
                table: "Messages",
                type: "varchar(2048)",
                maxLength: 2048,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<long>(
                name: "WebhookId",
                table: "Messages",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WebhookUsername",
                table: "Messages",
                type: "varchar(80)",
                maxLength: 80,
                nullable: true)
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<int>(
                name: "DefaultPermissions_ManageWebhooks",
                table: "Guilds",
                type: "int",
                nullable: false,
                defaultValue: 1);  // PermissionState.Deny: only admins manage webhooks by default

            migrationBuilder.AddColumn<int>(
                name: "Permissions_ManageWebhooks",
                table: "ChannelPermissionOverrides",
                type: "int",
                nullable: false,
                defaultValue: 2);  // PermissionState.Inherit: existing overrides leave it alone

            migrationBuilder.CreateTable(
                name: "Webhooks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    GuildId = table.Column<long>(type: "bigint", nullable: true),
                    ChannelId = table.Column<long>(type: "bigint", nullable: true),
                    Name = table.Column<string>(type: "varchar(80)", maxLength: 80, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Token = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    HasAvatar = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedById = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Webhooks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Webhooks_Channels_ChannelId",
                        column: x => x.ChannelId,
                        principalTable: "Channels",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Webhooks_Guilds_GuildId",
                        column: x => x.GuildId,
                        principalTable: "Guilds",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Webhooks_Users_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_Messages_WebhookId",
                table: "Messages",
                column: "WebhookId");

            migrationBuilder.CreateIndex(
                name: "IX_Webhooks_ChannelId",
                table: "Webhooks",
                column: "ChannelId");

            migrationBuilder.CreateIndex(
                name: "IX_Webhooks_CreatedById",
                table: "Webhooks",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_Webhooks_GuildId",
                table: "Webhooks",
                column: "GuildId");

            migrationBuilder.AddForeignKey(
                name: "FK_Messages_Webhooks_WebhookId",
                table: "Messages",
                column: "WebhookId",
                principalTable: "Webhooks",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Messages_Webhooks_WebhookId",
                table: "Messages");

            migrationBuilder.DropTable(
                name: "Webhooks");

            migrationBuilder.DropIndex(
                name: "IX_Messages_WebhookId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "Permissions_ManageWebhooks",
                table: "Roles");

            migrationBuilder.DropColumn(
                name: "WebhookAvatarUrl",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "WebhookId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "WebhookUsername",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "DefaultPermissions_ManageWebhooks",
                table: "Guilds");

            migrationBuilder.DropColumn(
                name: "Permissions_ManageWebhooks",
                table: "ChannelPermissionOverrides");

            migrationBuilder.UpdateData(
                table: "Messages",
                keyColumn: "AuthorId",
                keyValue: null,
                column: "AuthorId",
                value: "");

            migrationBuilder.AlterColumn<string>(
                name: "AuthorId",
                table: "Messages",
                type: "varchar(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "varchar(64)",
                oldMaxLength: 64,
                oldNullable: true)
                .Annotation("MySql:CharSet", "utf8mb4")
                .OldAnnotation("MySql:CharSet", "utf8mb4");
        }
    }
}
