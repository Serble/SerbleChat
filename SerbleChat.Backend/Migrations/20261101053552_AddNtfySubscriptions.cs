using System;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddNtfySubscriptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "WebPushIncludeContent",
                table: "Users",
                type: "tinyint(1)",
                nullable: false,
                defaultValue: true);  // existing users keep the content they already get in web push

            migrationBuilder.CreateTable(
                name: "UserNtfySubscriptions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("MySql:ValueGenerationStrategy", MySqlValueGenerationStrategy.IdentityColumn),
                    UserId = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ServerUrl = table.Column<string>(type: "varchar(512)", maxLength: 512, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    Topic = table.Column<string>(type: "varchar(64)", maxLength: 64, nullable: false)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    AccessToken = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    IncludeContent = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    Enabled = table.Column<bool>(type: "tinyint(1)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime(6)", nullable: false),
                    LastSuccessAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    LastFailureAt = table.Column<DateTime>(type: "datetime(6)", nullable: true),
                    LastError = table.Column<string>(type: "varchar(255)", maxLength: 255, nullable: true)
                        .Annotation("MySql:CharSet", "utf8mb4"),
                    ConsecutiveFailures = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserNtfySubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UserNtfySubscriptions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                })
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.CreateIndex(
                name: "IX_UserNtfySubscriptions_UserId",
                table: "UserNtfySubscriptions",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "UserNtfySubscriptions");

            migrationBuilder.DropColumn(
                name: "WebPushIncludeContent",
                table: "Users");
        }
    }
}
