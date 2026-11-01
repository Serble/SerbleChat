using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SerbleChat.Backend.Migrations
{
    /// <inheritdoc />
    public partial class AddPushSubscriptionKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Kind",
                table: "UserWebNotificationHooks",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Kind",
                table: "UserWebNotificationHooks");
        }
    }
}
