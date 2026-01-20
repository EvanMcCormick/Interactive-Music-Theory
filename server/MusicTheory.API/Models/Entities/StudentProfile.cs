namespace MusicTheory.API.Models.Entities;

public class StudentProfile
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public int CurrentLevel { get; set; } = 1;
    public long TotalXP { get; set; } = 0;
    public int CurrentStreak { get; set; } = 0;
    public DateTime? LastPracticeDate { get; set; }
    public string? Instruments { get; set; } // JSON array
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public User User { get; set; } = null!;
    public ICollection<Enrollment> Enrollments { get; set; } = new List<Enrollment>();
}
