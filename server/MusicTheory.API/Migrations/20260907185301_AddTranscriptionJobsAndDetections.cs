using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MusicTheory.API.Migrations
{
    /// <inheritdoc />
    public partial class AddTranscriptionJobsAndDetections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TranscriptionDetections",
                columns: table => new
                {
                    ContentHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    RawNotes = table.Column<byte[]>(type: "varbinary(max)", nullable: false),
                    BendFrameRateHz = table.Column<double>(type: "float", nullable: false),
                    DurationSec = table.Column<double>(type: "float", nullable: false),
                    NoteCount = table.Column<int>(type: "int", nullable: false),
                    FromSeparation = table.Column<bool>(type: "bit", nullable: false),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TranscriptionDetections", x => x.ContentHash);
                });

            migrationBuilder.CreateTable(
                name: "TranscriptionJobs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ContentHash = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    FileName = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    Progress = table.Column<double>(type: "float", nullable: false),
                    Error = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CreatedUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompletedUtc = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TranscriptionJobs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TranscriptionJobs_ContentHash",
                table: "TranscriptionJobs",
                column: "ContentHash");

            migrationBuilder.CreateIndex(
                name: "IX_TranscriptionJobs_UserId_CreatedUtc",
                table: "TranscriptionJobs",
                columns: new[] { "UserId", "CreatedUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TranscriptionDetections");

            migrationBuilder.DropTable(
                name: "TranscriptionJobs");
        }
    }
}
