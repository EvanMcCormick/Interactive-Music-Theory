namespace MusicTheory.API.Models.Entities;

public class Invitation
{
    public Guid Id { get; set; }
    public Guid TeacherId { get; set; }
    public string Email { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public TeacherProfile Teacher { get; set; } = null!;
}
