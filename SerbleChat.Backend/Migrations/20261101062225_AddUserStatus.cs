using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddUserStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "NotificationsWhileAway",
                table: "Users",
                type: "tinyint(1)",
                nullable: false,
                // Existing users get the new default: push while away is on
                defaultValue: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "StatusExpiresAt",
                table: "Users",
                type: "datetime(6)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StatusMessage",
                table: "Users",
                type: "varchar(128)",
                maxLength: 128,
                nullable: false,
                defaultValue: "")
                .Annotation("MySql:CharSet", "utf8mb4");

            migrationBuilder.AddColumn<int>(
                name: "StatusType",
                table: "Users",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NotificationsWhileAway",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "StatusExpiresAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "StatusMessage",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "StatusType",
                table: "Users");
        }
    }
}
