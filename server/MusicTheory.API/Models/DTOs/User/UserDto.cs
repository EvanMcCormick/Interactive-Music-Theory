using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.DTOs.User;

public class UserDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public UserRole Role { get; set; }
    public DateTime CreatedAt { get; set; }
    public TeacherProfileDto? TeacherProfile { get; set; }
    public StudentProfileDto? StudentProfile { get; set; }
}

public class TeacherProfileDto
{
    public Guid Id { get; set; }
    public string? Bio { get; set; }
    public bool IsPublic { get; set; }
    public List<string> Instruments { get; set; } = new();
    public List<string> Specializations { get; set; } = new();
    public decimal? HourlyRate { get; set; }
    public bool HasStripeConnected { get; set; }
}

public class StudentProfileDto
{
    public Guid Id { get; set; }
    public int CurrentLevel { get; set; }
    public long TotalXP { get; set; }
    public int CurrentStreak { get; set; }
    public List<string> Instruments { get; set; } = new();
}
