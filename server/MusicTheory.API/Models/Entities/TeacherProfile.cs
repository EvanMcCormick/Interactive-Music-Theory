namespace MusicTheory.API.Models.Entities;

public class TeacherProfile
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string? Bio { get; set; }
    public bool IsPublic { get; set; } = false;
    public string? Instruments { get; set; } // JSON array
    public string? Specializations { get; set; } // JSON array
    public decimal? HourlyRate { get; set; }
    public string? StripeConnectId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public User User { get; set; } = null!;
    public ICollection<Enrollment> Students { get; set; } = new List<Enrollment>();
    public ICollection<Invitation> Invitations { get; set; } = new List<Invitation>();
}
