using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.Entities;

public class Enrollment
{
    public Guid Id { get; set; }
    public Guid TeacherId { get; set; }
    public Guid StudentId { get; set; }
    public EnrollmentStatus Status { get; set; } = EnrollmentStatus.Active;
    public ProgressionMode ProgressionMode { get; set; } = ProgressionMode.Linear;
    public Guid? AssignedCurriculumId { get; set; }
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }

    // Navigation properties
    public TeacherProfile Teacher { get; set; } = null!;
    public StudentProfile Student { get; set; } = null!;
}
