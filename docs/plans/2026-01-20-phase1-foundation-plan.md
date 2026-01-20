# Phase 1: Foundation - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the authentication and user management foundation for the MusicTheory SaaS platform.

**Architecture:** ASP.NET Core 9 with Identity for auth, EF Core 9 with Azure SQL for persistence, JWT tokens for API auth with OAuth social logins. Angular frontend with auth guards and interceptors.

**Tech Stack:** .NET 9, EF Core 9, ASP.NET Core Identity, Azure SQL (local SQL Server for dev), Angular 21, RxJS

---

## Prerequisites

Before starting, ensure you have:
- SQL Server installed locally (or LocalDB)
- .NET 9 SDK installed
- Node.js 20+ and npm installed
- Azure account (for later deployment, not needed for local dev)

---

## Task 1: Update Project Structure and Dependencies

**Files:**
- Modify: `server/MusicTheory.API/MusicTheory.API.csproj`
- Delete: `server/MusicTheory.API/Controllers/new`
- Delete: `server/MusicTheory.API/Models/new`
- Delete: `server/MusicTheory.API/Services/new`

**Step 1: Add required NuGet packages**

Update `server/MusicTheory.API/MusicTheory.API.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net9.0</TargetFramework>
    <RootNamespace>MusicTheory.API</RootNamespace>
    <AssemblyName>MusicTheory.API</AssemblyName>
    <OutputType>Exe</OutputType>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <!-- ASP.NET Core -->
    <PackageReference Include="Microsoft.AspNetCore.Mvc.NewtonsoftJson" Version="9.0.0" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="7.0.0" />

    <!-- Entity Framework Core -->
    <PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="9.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Tools" Version="9.0.0" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="9.0.0" />

    <!-- Identity -->
    <PackageReference Include="Microsoft.AspNetCore.Identity.EntityFrameworkCore" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.JwtBearer" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.Google" Version="9.0.0" />
    <PackageReference Include="Microsoft.AspNetCore.Authentication.MicrosoftAccount" Version="9.0.0" />
  </ItemGroup>

</Project>
```

**Step 2: Delete placeholder files**

Run:
```bash
rm server/MusicTheory.API/Controllers/new
rm server/MusicTheory.API/Models/new
rm server/MusicTheory.API/Services/new
```

**Step 3: Restore packages**

Run:
```bash
cd server/MusicTheory.API && dotnet restore
```
Expected: Packages restored successfully

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: Update dependencies for Identity and JWT auth"
```

---

## Task 2: Create Domain Models

**Files:**
- Create: `server/MusicTheory.API/Models/Entities/User.cs`
- Create: `server/MusicTheory.API/Models/Entities/TeacherProfile.cs`
- Create: `server/MusicTheory.API/Models/Entities/StudentProfile.cs`
- Create: `server/MusicTheory.API/Models/Entities/Enrollment.cs`
- Create: `server/MusicTheory.API/Models/Entities/Invitation.cs`
- Create: `server/MusicTheory.API/Models/Enums/UserRole.cs`
- Create: `server/MusicTheory.API/Models/Enums/EnrollmentStatus.cs`
- Create: `server/MusicTheory.API/Models/Enums/ProgressionMode.cs`

**Step 1: Create Enums directory and files**

Create `server/MusicTheory.API/Models/Enums/UserRole.cs`:

```csharp
namespace MusicTheory.API.Models.Enums;

public enum UserRole
{
    Student = 0,
    Teacher = 1,
    Admin = 2
}
```

Create `server/MusicTheory.API/Models/Enums/EnrollmentStatus.cs`:

```csharp
namespace MusicTheory.API.Models.Enums;

public enum EnrollmentStatus
{
    Active = 0,
    Paused = 1,
    Completed = 2
}
```

Create `server/MusicTheory.API/Models/Enums/ProgressionMode.cs`:

```csharp
namespace MusicTheory.API.Models.Enums;

public enum ProgressionMode
{
    Linear = 0,
    Flexible = 1
}
```

**Step 2: Create User entity (extends IdentityUser)**

Create `server/MusicTheory.API/Models/Entities/User.cs`:

```csharp
using Microsoft.AspNetCore.Identity;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.Entities;

public class User : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;
    public string? AvatarUrl { get; set; }
    public UserRole Role { get; set; } = UserRole.Student;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }

    // Navigation properties
    public TeacherProfile? TeacherProfile { get; set; }
    public StudentProfile? StudentProfile { get; set; }
}
```

**Step 3: Create TeacherProfile entity**

Create `server/MusicTheory.API/Models/Entities/TeacherProfile.cs`:

```csharp
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
```

**Step 4: Create StudentProfile entity**

Create `server/MusicTheory.API/Models/Entities/StudentProfile.cs`:

```csharp
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
```

**Step 5: Create Enrollment entity**

Create `server/MusicTheory.API/Models/Entities/Enrollment.cs`:

```csharp
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
```

**Step 6: Create Invitation entity**

Create `server/MusicTheory.API/Models/Entities/Invitation.cs`:

```csharp
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
```

**Step 7: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: Add domain models for users, profiles, enrollments"
```

---

## Task 3: Create Database Context

**Files:**
- Create: `server/MusicTheory.API/Data/MusicTheoryDbContext.cs`

**Step 1: Create the DbContext**

Create `server/MusicTheory.API/Data/MusicTheoryDbContext.cs`:

```csharp
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Data;

public class MusicTheoryDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    public MusicTheoryDbContext(DbContextOptions<MusicTheoryDbContext> options)
        : base(options)
    {
    }

    public DbSet<TeacherProfile> TeacherProfiles => Set<TeacherProfile>();
    public DbSet<StudentProfile> StudentProfiles => Set<StudentProfile>();
    public DbSet<Enrollment> Enrollments => Set<Enrollment>();
    public DbSet<Invitation> Invitations => Set<Invitation>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // User configuration
        builder.Entity<User>(entity =>
        {
            entity.HasOne(u => u.TeacherProfile)
                .WithOne(t => t.User)
                .HasForeignKey<TeacherProfile>(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(u => u.StudentProfile)
                .WithOne(s => s.User)
                .HasForeignKey<StudentProfile>(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // TeacherProfile configuration
        builder.Entity<TeacherProfile>(entity =>
        {
            entity.HasKey(t => t.Id);
            entity.HasIndex(t => t.UserId).IsUnique();
        });

        // StudentProfile configuration
        builder.Entity<StudentProfile>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.HasIndex(s => s.UserId).IsUnique();
        });

        // Enrollment configuration
        builder.Entity<Enrollment>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.Teacher)
                .WithMany(t => t.Students)
                .HasForeignKey(e => e.TeacherId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasOne(e => e.Student)
                .WithMany(s => s.Enrollments)
                .HasForeignKey(e => e.StudentId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => new { e.TeacherId, e.StudentId }).IsUnique();
        });

        // Invitation configuration
        builder.Entity<Invitation>(entity =>
        {
            entity.HasKey(i => i.Id);
            entity.HasIndex(i => i.Code).IsUnique();
            entity.HasIndex(i => new { i.TeacherId, i.Email });

            entity.HasOne(i => i.Teacher)
                .WithMany(t => t.Invitations)
                .HasForeignKey(i => i.TeacherId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
```

**Step 2: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Add MusicTheoryDbContext with Identity integration"
```

---

## Task 4: Create DTOs for API

**Files:**
- Create: `server/MusicTheory.API/Models/DTOs/Auth/RegisterRequest.cs`
- Create: `server/MusicTheory.API/Models/DTOs/Auth/LoginRequest.cs`
- Create: `server/MusicTheory.API/Models/DTOs/Auth/AuthResponse.cs`
- Create: `server/MusicTheory.API/Models/DTOs/Auth/RefreshTokenRequest.cs`
- Create: `server/MusicTheory.API/Models/DTOs/User/UserDto.cs`
- Create: `server/MusicTheory.API/Models/DTOs/User/UpdateUserRequest.cs`

**Step 1: Create Auth DTOs**

Create `server/MusicTheory.API/Models/DTOs/Auth/RegisterRequest.cs`:

```csharp
using System.ComponentModel.DataAnnotations;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Models.DTOs.Auth;

public class RegisterRequest
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string Password { get; set; } = string.Empty;

    [Required]
    [MinLength(2)]
    [MaxLength(100)]
    public string DisplayName { get; set; } = string.Empty;

    [Required]
    public UserRole Role { get; set; } = UserRole.Student;

    public string? InvitationCode { get; set; }
}
```

Create `server/MusicTheory.API/Models/DTOs/Auth/LoginRequest.cs`:

```csharp
using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.DTOs.Auth;

public class LoginRequest
{
    [Required]
    [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}
```

Create `server/MusicTheory.API/Models/DTOs/Auth/AuthResponse.cs`:

```csharp
using MusicTheory.API.Models.DTOs.User;

namespace MusicTheory.API.Models.DTOs.Auth;

public class AuthResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public UserDto User { get; set; } = null!;
}
```

Create `server/MusicTheory.API/Models/DTOs/Auth/RefreshTokenRequest.cs`:

```csharp
using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.DTOs.Auth;

public class RefreshTokenRequest
{
    [Required]
    public string RefreshToken { get; set; } = string.Empty;
}
```

**Step 2: Create User DTOs**

Create `server/MusicTheory.API/Models/DTOs/User/UserDto.cs`:

```csharp
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
```

Create `server/MusicTheory.API/Models/DTOs/User/UpdateUserRequest.cs`:

```csharp
using System.ComponentModel.DataAnnotations;

namespace MusicTheory.API.Models.DTOs.User;

public class UpdateUserRequest
{
    [MinLength(2)]
    [MaxLength(100)]
    public string? DisplayName { get; set; }

    public string? AvatarUrl { get; set; }
}
```

**Step 3: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Add DTOs for auth and user endpoints"
```

---

## Task 5: Create JWT and Auth Services

**Files:**
- Create: `server/MusicTheory.API/Services/IJwtService.cs`
- Create: `server/MusicTheory.API/Services/JwtService.cs`
- Create: `server/MusicTheory.API/Services/IAuthService.cs`
- Create: `server/MusicTheory.API/Services/AuthService.cs`
- Create: `server/MusicTheory.API/Models/Entities/RefreshToken.cs`

**Step 1: Create RefreshToken entity**

Create `server/MusicTheory.API/Models/Entities/RefreshToken.cs`:

```csharp
namespace MusicTheory.API.Models.Entities;

public class RefreshToken
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Token { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? RevokedAt { get; set; }
    public string? ReplacedByToken { get; set; }

    public bool IsExpired => DateTime.UtcNow >= ExpiresAt;
    public bool IsRevoked => RevokedAt != null;
    public bool IsActive => !IsRevoked && !IsExpired;

    // Navigation
    public User User { get; set; } = null!;
}
```

**Step 2: Update DbContext to include RefreshToken**

Add to `server/MusicTheory.API/Data/MusicTheoryDbContext.cs` (after other DbSet declarations):

```csharp
public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
```

And add to OnModelCreating method:

```csharp
// RefreshToken configuration
builder.Entity<RefreshToken>(entity =>
{
    entity.HasKey(r => r.Id);
    entity.HasIndex(r => r.Token).IsUnique();
    entity.HasIndex(r => r.UserId);

    entity.HasOne(r => r.User)
        .WithMany()
        .HasForeignKey(r => r.UserId)
        .OnDelete(DeleteBehavior.Cascade);
});
```

**Step 3: Create JWT service interface and implementation**

Create `server/MusicTheory.API/Services/IJwtService.cs`:

```csharp
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services;

public interface IJwtService
{
    string GenerateAccessToken(User user);
    RefreshToken GenerateRefreshToken(Guid userId);
    Guid? ValidateAccessToken(string token);
}
```

Create `server/MusicTheory.API/Services/JwtService.cs`:

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services;

public class JwtSettings
{
    public string Key { get; set; } = string.Empty;
    public string Issuer { get; set; } = string.Empty;
    public string Audience { get; set; } = string.Empty;
    public int AccessTokenExpirationMinutes { get; set; } = 15;
    public int RefreshTokenExpirationDays { get; set; } = 7;
}

public class JwtService : IJwtService
{
    private readonly JwtSettings _settings;

    public JwtService(IOptions<JwtSettings> settings)
    {
        _settings = settings.Value;
    }

    public string GenerateAccessToken(User user)
    {
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_settings.Key));
        var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
            new Claim(ClaimTypes.Name, user.DisplayName),
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        var token = new JwtSecurityToken(
            issuer: _settings.Issuer,
            audience: _settings.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(_settings.AccessTokenExpirationMinutes),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public RefreshToken GenerateRefreshToken(Guid userId)
    {
        var randomBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);

        return new RefreshToken
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Token = Convert.ToBase64String(randomBytes),
            ExpiresAt = DateTime.UtcNow.AddDays(_settings.RefreshTokenExpirationDays),
            CreatedAt = DateTime.UtcNow
        };
    }

    public Guid? ValidateAccessToken(string token)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.UTF8.GetBytes(_settings.Key);

        try
        {
            tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = true,
                ValidIssuer = _settings.Issuer,
                ValidateAudience = true,
                ValidAudience = _settings.Audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            }, out var validatedToken);

            var jwtToken = (JwtSecurityToken)validatedToken;
            var userId = Guid.Parse(jwtToken.Claims.First(x => x.Type == JwtRegisteredClaimNames.Sub).Value);

            return userId;
        }
        catch
        {
            return null;
        }
    }
}
```

**Step 4: Create Auth service interface and implementation**

Create `server/MusicTheory.API/Services/IAuthService.cs`:

```csharp
using MusicTheory.API.Models.DTOs.Auth;

namespace MusicTheory.API.Services;

public interface IAuthService
{
    Task<AuthResponse> RegisterAsync(RegisterRequest request);
    Task<AuthResponse> LoginAsync(LoginRequest request);
    Task<AuthResponse> RefreshTokenAsync(string refreshToken);
    Task RevokeTokenAsync(string refreshToken);
}
```

Create `server/MusicTheory.API/Services/AuthService.cs`:

```csharp
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.Auth;
using MusicTheory.API.Models.DTOs.User;
using MusicTheory.API.Models.Entities;
using MusicTheory.API.Models.Enums;

namespace MusicTheory.API.Services;

public class AuthService : IAuthService
{
    private readonly UserManager<User> _userManager;
    private readonly MusicTheoryDbContext _context;
    private readonly IJwtService _jwtService;

    public AuthService(
        UserManager<User> userManager,
        MusicTheoryDbContext context,
        IJwtService jwtService)
    {
        _userManager = userManager;
        _context = context;
        _jwtService = jwtService;
    }

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request)
    {
        // Check if user exists
        var existingUser = await _userManager.FindByEmailAsync(request.Email);
        if (existingUser != null)
        {
            throw new InvalidOperationException("User with this email already exists");
        }

        // Handle invitation code if provided
        Invitation? invitation = null;
        if (!string.IsNullOrEmpty(request.InvitationCode))
        {
            invitation = await _context.Invitations
                .FirstOrDefaultAsync(i => i.Code == request.InvitationCode
                    && i.Email.ToLower() == request.Email.ToLower()
                    && i.AcceptedAt == null
                    && i.ExpiresAt > DateTime.UtcNow);

            if (invitation == null)
            {
                throw new InvalidOperationException("Invalid or expired invitation code");
            }
        }

        // Create user
        var user = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.Email,
            Email = request.Email,
            DisplayName = request.DisplayName,
            Role = request.Role,
            CreatedAt = DateTime.UtcNow
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var errors = string.Join(", ", result.Errors.Select(e => e.Description));
            throw new InvalidOperationException($"Failed to create user: {errors}");
        }

        // Create profile based on role
        if (user.Role == UserRole.Teacher)
        {
            var teacherProfile = new TeacherProfile
            {
                Id = Guid.NewGuid(),
                UserId = user.Id
            };
            _context.TeacherProfiles.Add(teacherProfile);
        }

        // Always create student profile (teachers can also be students)
        var studentProfile = new StudentProfile
        {
            Id = Guid.NewGuid(),
            UserId = user.Id
        };
        _context.StudentProfiles.Add(studentProfile);

        // Handle invitation acceptance
        if (invitation != null)
        {
            invitation.AcceptedAt = DateTime.UtcNow;

            // Create enrollment
            var teacher = await _context.TeacherProfiles
                .FirstOrDefaultAsync(t => t.Id == invitation.TeacherId);

            if (teacher != null)
            {
                var enrollment = new Enrollment
                {
                    Id = Guid.NewGuid(),
                    TeacherId = teacher.Id,
                    StudentId = studentProfile.Id,
                    Status = EnrollmentStatus.Active
                };
                _context.Enrollments.Add(enrollment);
            }
        }

        await _context.SaveChangesAsync();

        return await GenerateAuthResponseAsync(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            throw new InvalidOperationException("Invalid email or password");
        }

        var isValidPassword = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!isValidPassword)
        {
            throw new InvalidOperationException("Invalid email or password");
        }

        user.LastLoginAt = DateTime.UtcNow;
        await _userManager.UpdateAsync(user);

        return await GenerateAuthResponseAsync(user);
    }

    public async Task<AuthResponse> RefreshTokenAsync(string refreshToken)
    {
        var storedToken = await _context.RefreshTokens
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Token == refreshToken);

        if (storedToken == null || !storedToken.IsActive)
        {
            throw new InvalidOperationException("Invalid refresh token");
        }

        // Revoke old token
        storedToken.RevokedAt = DateTime.UtcNow;

        // Generate new tokens
        var response = await GenerateAuthResponseAsync(storedToken.User);

        storedToken.ReplacedByToken = response.RefreshToken;
        await _context.SaveChangesAsync();

        return response;
    }

    public async Task RevokeTokenAsync(string refreshToken)
    {
        var storedToken = await _context.RefreshTokens
            .FirstOrDefaultAsync(r => r.Token == refreshToken);

        if (storedToken == null)
        {
            throw new InvalidOperationException("Token not found");
        }

        storedToken.RevokedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
    }

    private async Task<AuthResponse> GenerateAuthResponseAsync(User user)
    {
        var accessToken = _jwtService.GenerateAccessToken(user);
        var refreshToken = _jwtService.GenerateRefreshToken(user.Id);

        _context.RefreshTokens.Add(refreshToken);
        await _context.SaveChangesAsync();

        // Load profiles
        var userWithProfiles = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstAsync(u => u.Id == user.Id);

        return new AuthResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken.Token,
            ExpiresAt = DateTime.UtcNow.AddMinutes(15),
            User = MapToUserDto(userWithProfiles)
        };
    }

    private static UserDto MapToUserDto(User user)
    {
        return new UserDto
        {
            Id = user.Id,
            Email = user.Email ?? string.Empty,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            Role = user.Role,
            CreatedAt = user.CreatedAt,
            TeacherProfile = user.TeacherProfile != null ? new TeacherProfileDto
            {
                Id = user.TeacherProfile.Id,
                Bio = user.TeacherProfile.Bio,
                IsPublic = user.TeacherProfile.IsPublic,
                Instruments = ParseJsonArray(user.TeacherProfile.Instruments),
                Specializations = ParseJsonArray(user.TeacherProfile.Specializations),
                HourlyRate = user.TeacherProfile.HourlyRate,
                HasStripeConnected = !string.IsNullOrEmpty(user.TeacherProfile.StripeConnectId)
            } : null,
            StudentProfile = user.StudentProfile != null ? new StudentProfileDto
            {
                Id = user.StudentProfile.Id,
                CurrentLevel = user.StudentProfile.CurrentLevel,
                TotalXP = user.StudentProfile.TotalXP,
                CurrentStreak = user.StudentProfile.CurrentStreak,
                Instruments = ParseJsonArray(user.StudentProfile.Instruments)
            } : null
        };
    }

    private static List<string> ParseJsonArray(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new List<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }
}
```

**Step 5: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: Add JWT and Auth services"
```

---

## Task 6: Configure Application Startup

**Files:**
- Modify: `server/MusicTheory.API/Program.cs`
- Modify: `server/MusicTheory.API/Startup.cs`
- Modify: `server/MusicTheory.API/appsettings.json`
- Create: `server/MusicTheory.API/appsettings.Development.json`

**Step 1: Update appsettings.json**

Replace `server/MusicTheory.API/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "ConnectionStrings": {
    "DefaultConnection": ""
  },
  "Jwt": {
    "Key": "",
    "Issuer": "MusicTheory.API",
    "Audience": "MusicTheory.Client",
    "AccessTokenExpirationMinutes": 15,
    "RefreshTokenExpirationDays": 7
  },
  "Cors": {
    "AllowedOrigins": []
  }
}
```

**Step 2: Create appsettings.Development.json**

Create `server/MusicTheory.API/appsettings.Development.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Debug",
      "Microsoft.AspNetCore": "Information",
      "Microsoft.EntityFrameworkCore": "Information"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\mssqllocaldb;Database=MusicTheoryDb;Trusted_Connection=True;MultipleActiveResultSets=true"
  },
  "Jwt": {
    "Key": "YourSuperSecretKeyThatIsAtLeast32CharactersLong!",
    "Issuer": "MusicTheory.API",
    "Audience": "MusicTheory.Client",
    "AccessTokenExpirationMinutes": 15,
    "RefreshTokenExpirationDays": 7
  },
  "Cors": {
    "AllowedOrigins": ["http://localhost:4200"]
  }
}
```

**Step 3: Replace Startup.cs with modern configuration**

Replace `server/MusicTheory.API/Startup.cs`:

```csharp
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using MusicTheory.API.Data;
using MusicTheory.API.Models.Entities;
using MusicTheory.API.Services;

namespace MusicTheory.API;

public class Startup
{
    public IConfiguration Configuration { get; }

    public Startup(IConfiguration configuration)
    {
        Configuration = configuration;
    }

    public void ConfigureServices(IServiceCollection services)
    {
        // Database
        services.AddDbContext<MusicTheoryDbContext>(options =>
            options.UseSqlServer(Configuration.GetConnectionString("DefaultConnection")));

        // Identity
        services.AddIdentity<User, IdentityRole<Guid>>(options =>
        {
            options.Password.RequireDigit = true;
            options.Password.RequireLowercase = true;
            options.Password.RequireUppercase = true;
            options.Password.RequireNonAlphanumeric = false;
            options.Password.RequiredLength = 8;
            options.User.RequireUniqueEmail = true;
        })
        .AddEntityFrameworkStores<MusicTheoryDbContext>()
        .AddDefaultTokenProviders();

        // JWT Configuration
        var jwtSettings = Configuration.GetSection("Jwt");
        services.Configure<JwtSettings>(jwtSettings);

        var key = Encoding.UTF8.GetBytes(jwtSettings["Key"]!);
        services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = true,
                ValidIssuer = jwtSettings["Issuer"],
                ValidateAudience = true,
                ValidAudience = jwtSettings["Audience"],
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            };
        });

        // Services
        services.AddScoped<IJwtService, JwtService>();
        services.AddScoped<IAuthService, AuthService>();

        // CORS
        var corsOrigins = Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
        services.AddCors(options =>
        {
            options.AddPolicy("AllowAngularApp", builder =>
            {
                builder.WithOrigins(corsOrigins)
                    .AllowAnyMethod()
                    .AllowAnyHeader()
                    .AllowCredentials();
            });
        });

        // Controllers
        services.AddControllers()
            .AddNewtonsoftJson(options =>
            {
                options.SerializerSettings.ReferenceLoopHandling = Newtonsoft.Json.ReferenceLoopHandling.Ignore;
            });

        // Swagger
        services.AddEndpointsApiExplorer();
        services.AddSwaggerGen(c =>
        {
            c.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "MusicTheory API",
                Version = "v1",
                Description = "API for MusicTheory SaaS Platform"
            });

            c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
            {
                Description = "JWT Authorization header using the Bearer scheme. Enter 'Bearer' [space] and then your token.",
                Name = "Authorization",
                In = ParameterLocation.Header,
                Type = SecuritySchemeType.ApiKey,
                Scheme = "Bearer"
            });

            c.AddSecurityRequirement(new OpenApiSecurityRequirement
            {
                {
                    new OpenApiSecurityScheme
                    {
                        Reference = new OpenApiReference
                        {
                            Type = ReferenceType.SecurityScheme,
                            Id = "Bearer"
                        }
                    },
                    Array.Empty<string>()
                }
            });
        });
    }

    public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
    {
        if (env.IsDevelopment())
        {
            app.UseDeveloperExceptionPage();
            app.UseSwagger();
            app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "MusicTheory API v1"));
        }
        else
        {
            app.UseExceptionHandler("/error");
            app.UseHsts();
        }

        app.UseHttpsRedirection();
        app.UseRouting();

        app.UseCors("AllowAngularApp");

        app.UseAuthentication();
        app.UseAuthorization();

        app.UseEndpoints(endpoints =>
        {
            endpoints.MapControllers();
        });
    }
}
```

**Step 4: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: Configure Identity, JWT auth, CORS, and Swagger"
```

---

## Task 7: Create Auth Controller

**Files:**
- Create: `server/MusicTheory.API/Controllers/AuthController.cs`

**Step 1: Create the AuthController**

Create `server/MusicTheory.API/Controllers/AuthController.cs`:

```csharp
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MusicTheory.API.Models.DTOs.Auth;
using MusicTheory.API.Services;

namespace MusicTheory.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;

    public AuthController(IAuthService authService)
    {
        _authService = authService;
    }

    /// <summary>
    /// Register a new user
    /// </summary>
    [HttpPost("register")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<AuthResponse>> Register([FromBody] RegisterRequest request)
    {
        try
        {
            var response = await _authService.RegisterAsync(request);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Registration failed",
                Detail = ex.Message,
                Status = StatusCodes.Status400BadRequest
            });
        }
    }

    /// <summary>
    /// Login with email and password
    /// </summary>
    [HttpPost("login")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AuthResponse>> Login([FromBody] LoginRequest request)
    {
        try
        {
            var response = await _authService.LoginAsync(request);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return Unauthorized(new ProblemDetails
            {
                Title = "Login failed",
                Detail = ex.Message,
                Status = StatusCodes.Status401Unauthorized
            });
        }
    }

    /// <summary>
    /// Refresh access token using refresh token
    /// </summary>
    [HttpPost("refresh")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ProblemDetails), StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<AuthResponse>> Refresh([FromBody] RefreshTokenRequest request)
    {
        try
        {
            var response = await _authService.RefreshTokenAsync(request.RefreshToken);
            return Ok(response);
        }
        catch (InvalidOperationException ex)
        {
            return Unauthorized(new ProblemDetails
            {
                Title = "Token refresh failed",
                Detail = ex.Message,
                Status = StatusCodes.Status401Unauthorized
            });
        }
    }

    /// <summary>
    /// Logout and revoke refresh token
    /// </summary>
    [Authorize]
    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout([FromBody] RefreshTokenRequest request)
    {
        try
        {
            await _authService.RevokeTokenAsync(request.RefreshToken);
            return NoContent();
        }
        catch
        {
            return NoContent(); // Don't reveal whether token existed
        }
    }
}
```

**Step 2: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Add AuthController with register, login, refresh, logout"
```

---

## Task 8: Create Users Controller

**Files:**
- Create: `server/MusicTheory.API/Controllers/UsersController.cs`
- Create: `server/MusicTheory.API/Services/IUserService.cs`
- Create: `server/MusicTheory.API/Services/UserService.cs`

**Step 1: Create User service interface**

Create `server/MusicTheory.API/Services/IUserService.cs`:

```csharp
using MusicTheory.API.Models.DTOs.User;

namespace MusicTheory.API.Services;

public interface IUserService
{
    Task<UserDto?> GetByIdAsync(Guid id);
    Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest request);
}
```

**Step 2: Create User service implementation**

Create `server/MusicTheory.API/Services/UserService.cs`:

```csharp
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MusicTheory.API.Data;
using MusicTheory.API.Models.DTOs.User;
using MusicTheory.API.Models.Entities;

namespace MusicTheory.API.Services;

public class UserService : IUserService
{
    private readonly MusicTheoryDbContext _context;

    public UserService(MusicTheoryDbContext context)
    {
        _context = context;
    }

    public async Task<UserDto?> GetByIdAsync(Guid id)
    {
        var user = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstOrDefaultAsync(u => u.Id == id);

        return user != null ? MapToUserDto(user) : null;
    }

    public async Task<UserDto> UpdateAsync(Guid id, UpdateUserRequest request)
    {
        var user = await _context.Users
            .Include(u => u.TeacherProfile)
            .Include(u => u.StudentProfile)
            .FirstOrDefaultAsync(u => u.Id == id);

        if (user == null)
        {
            throw new InvalidOperationException("User not found");
        }

        if (!string.IsNullOrEmpty(request.DisplayName))
        {
            user.DisplayName = request.DisplayName;
        }

        if (request.AvatarUrl != null)
        {
            user.AvatarUrl = request.AvatarUrl;
        }

        await _context.SaveChangesAsync();

        return MapToUserDto(user);
    }

    private static UserDto MapToUserDto(User user)
    {
        return new UserDto
        {
            Id = user.Id,
            Email = user.Email ?? string.Empty,
            DisplayName = user.DisplayName,
            AvatarUrl = user.AvatarUrl,
            Role = user.Role,
            CreatedAt = user.CreatedAt,
            TeacherProfile = user.TeacherProfile != null ? new TeacherProfileDto
            {
                Id = user.TeacherProfile.Id,
                Bio = user.TeacherProfile.Bio,
                IsPublic = user.TeacherProfile.IsPublic,
                Instruments = ParseJsonArray(user.TeacherProfile.Instruments),
                Specializations = ParseJsonArray(user.TeacherProfile.Specializations),
                HourlyRate = user.TeacherProfile.HourlyRate,
                HasStripeConnected = !string.IsNullOrEmpty(user.TeacherProfile.StripeConnectId)
            } : null,
            StudentProfile = user.StudentProfile != null ? new StudentProfileDto
            {
                Id = user.StudentProfile.Id,
                CurrentLevel = user.StudentProfile.CurrentLevel,
                TotalXP = user.StudentProfile.TotalXP,
                CurrentStreak = user.StudentProfile.CurrentStreak,
                Instruments = ParseJsonArray(user.StudentProfile.Instruments)
            } : null
        };
    }

    private static List<string> ParseJsonArray(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new List<string>();
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }
}
```

**Step 3: Create Users controller**

Create `server/MusicTheory.API/Controllers/UsersController.cs`:

```csharp
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MusicTheory.API.Models.DTOs.User;
using MusicTheory.API.Services;

namespace MusicTheory.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly IUserService _userService;

    public UsersController(IUserService userService)
    {
        _userService = userService;
    }

    /// <summary>
    /// Get current user's profile
    /// </summary>
    [HttpGet("me")]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<UserDto>> GetMe()
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        var user = await _userService.GetByIdAsync(userId.Value);
        if (user == null)
        {
            return NotFound();
        }

        return Ok(user);
    }

    /// <summary>
    /// Update current user's profile
    /// </summary>
    [HttpPut("me")]
    [ProducesResponseType(typeof(UserDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<UserDto>> UpdateMe([FromBody] UpdateUserRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var user = await _userService.UpdateAsync(userId.Value, request);
            return Ok(user);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "Update failed",
                Detail = ex.Message,
                Status = StatusCodes.Status400BadRequest
            });
        }
    }

    private Guid? GetCurrentUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;

        return Guid.TryParse(userIdClaim, out var userId) ? userId : null;
    }
}
```

**Step 4: Register UserService in Startup.cs**

Add to `ConfigureServices` in `server/MusicTheory.API/Startup.cs` (after other service registrations):

```csharp
services.AddScoped<IUserService, UserService>();
```

**Step 5: Verify compilation**

Run:
```bash
cd server/MusicTheory.API && dotnet build
```
Expected: Build succeeded

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: Add UsersController with me endpoint"
```

---

## Task 9: Create Database Migration

**Files:**
- Creates migration files in `server/MusicTheory.API/Migrations/`

**Step 1: Create initial migration**

Run:
```bash
cd server/MusicTheory.API && dotnet ef migrations add InitialCreate
```
Expected: Migration files created in Migrations folder

**Step 2: Verify migration was created**

Run:
```bash
ls server/MusicTheory.API/Migrations/
```
Expected: Should see migration files

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Add initial database migration"
```

---

## Task 10: Create Angular Auth Models

**Files:**
- Create: `client/src/app/models/auth.model.ts`
- Create: `client/src/app/models/user.model.ts`

**Step 1: Create auth models**

Create `client/src/app/models/auth.model.ts`:

```typescript
import { UserDto } from './user.model';

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  invitationCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: UserDto;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export enum UserRole {
  Student = 0,
  Teacher = 1,
  Admin = 2
}
```

**Step 2: Create user models**

Create `client/src/app/models/user.model.ts`:

```typescript
import { UserRole } from './auth.model';

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  teacherProfile?: TeacherProfileDto;
  studentProfile?: StudentProfileDto;
}

export interface TeacherProfileDto {
  id: string;
  bio?: string;
  isPublic: boolean;
  instruments: string[];
  specializations: string[];
  hourlyRate?: number;
  hasStripeConnected: boolean;
}

export interface StudentProfileDto {
  id: string;
  currentLevel: number;
  totalXP: number;
  currentStreak: number;
  instruments: string[];
}

export interface UpdateUserRequest {
  displayName?: string;
  avatarUrl?: string;
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Add Angular auth and user models"
```

---

## Task 11: Create Angular Auth Service

**Files:**
- Create: `client/src/app/services/auth.service.ts`
- Create: `client/src/app/interceptors/auth.interceptor.ts`

**Step 1: Create auth service**

Create `client/src/app/services/auth.service.ts`:

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, throwError } from 'rxjs';
import {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  RefreshTokenRequest,
  UserRole
} from '../models/auth.model';
import { UserDto } from '../models/user.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly API_URL = `${environment.apiUrl}/api/auth`;
  private readonly ACCESS_TOKEN_KEY = 'access_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';

  private currentUserSubject = new BehaviorSubject<UserDto | null>(null);
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);

  currentUser$ = this.currentUserSubject.asObservable();
  isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(private http: HttpClient) {
    this.checkStoredAuth();
  }

  get currentUser(): UserDto | null {
    return this.currentUserSubject.value;
  }

  get isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  get accessToken(): string | null {
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/register`, request)
      .pipe(
        tap(response => this.handleAuthResponse(response)),
        catchError(error => this.handleError(error))
      );
  }

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.API_URL}/login`, request)
      .pipe(
        tap(response => this.handleAuthResponse(response)),
        catchError(error => this.handleError(error))
      );
  }

  refreshToken(): Observable<AuthResponse> {
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token available'));
    }

    const request: RefreshTokenRequest = { refreshToken };
    return this.http.post<AuthResponse>(`${this.API_URL}/refresh`, request)
      .pipe(
        tap(response => this.handleAuthResponse(response)),
        catchError(error => {
          this.logout();
          return this.handleError(error);
        })
      );
  }

  logout(): void {
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
    if (refreshToken) {
      this.http.post(`${this.API_URL}/logout`, { refreshToken }).subscribe();
    }

    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    this.currentUserSubject.next(null);
    this.isAuthenticatedSubject.next(false);
  }

  isTeacher(): boolean {
    return this.currentUser?.role === UserRole.Teacher ||
           this.currentUser?.role === UserRole.Admin;
  }

  isAdmin(): boolean {
    return this.currentUser?.role === UserRole.Admin;
  }

  private handleAuthResponse(response: AuthResponse): void {
    localStorage.setItem(this.ACCESS_TOKEN_KEY, response.accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, response.refreshToken);
    this.currentUserSubject.next(response.user);
    this.isAuthenticatedSubject.next(true);
  }

  private checkStoredAuth(): void {
    const token = this.accessToken;
    if (token) {
      // Validate token by fetching current user
      this.http.get<UserDto>(`${environment.apiUrl}/api/users/me`)
        .subscribe({
          next: (user) => {
            this.currentUserSubject.next(user);
            this.isAuthenticatedSubject.next(true);
          },
          error: () => {
            // Token invalid, try refresh
            this.refreshToken().subscribe({
              error: () => this.logout()
            });
          }
        });
    }
  }

  private handleError(error: any): Observable<never> {
    const message = error.error?.detail || error.message || 'An error occurred';
    return throwError(() => new Error(message));
  }
}
```

**Step 2: Create auth interceptor**

Create `client/src/app/interceptors/auth.interceptor.ts`:

```typescript
import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;
  private refreshTokenSubject = new BehaviorSubject<string | null>(null);

  constructor(private authService: AuthService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const token = this.authService.accessToken;

    if (token) {
      request = this.addToken(request, token);
    }

    return next.handle(request).pipe(
      catchError(error => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          return this.handle401Error(request, next);
        }
        return throwError(() => error);
      })
    );
  }

  private addToken(request: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
    return request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  private handle401Error(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!this.isRefreshing) {
      this.isRefreshing = true;
      this.refreshTokenSubject.next(null);

      return this.authService.refreshToken().pipe(
        switchMap(response => {
          this.isRefreshing = false;
          this.refreshTokenSubject.next(response.accessToken);
          return next.handle(this.addToken(request, response.accessToken));
        }),
        catchError(error => {
          this.isRefreshing = false;
          this.authService.logout();
          return throwError(() => error);
        })
      );
    }

    return this.refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1),
      switchMap(token => next.handle(this.addToken(request, token!)))
    );
  }
}
```

**Step 3: Create environment file**

Create `client/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  apiUrl: 'https://localhost:5001'
};
```

Create `client/src/environments/environment.prod.ts`:

```typescript
export const environment = {
  production: true,
  apiUrl: '' // Will be set during deployment
};
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Add Angular AuthService and interceptor"
```

---

## Task 12: Create Angular Auth Guard

**Files:**
- Create: `client/src/app/guards/auth.guard.ts`
- Create: `client/src/app/guards/role.guard.ts`

**Step 1: Create auth guard**

Create `client/src/app/guards/auth.guard.ts`:

```typescript
import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { Observable, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> {
    return this.authService.isAuthenticated$.pipe(
      take(1),
      map(isAuthenticated => {
        if (isAuthenticated) {
          return true;
        }
        return this.router.createUrlTree(['/login']);
      })
    );
  }
}
```

**Step 2: Create role guard**

Create `client/src/app/guards/role.guard.ts`:

```typescript
import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { Observable, map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserRole } from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class RoleGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean | UrlTree> {
    const requiredRoles = route.data['roles'] as UserRole[];

    return this.authService.currentUser$.pipe(
      take(1),
      map(user => {
        if (!user) {
          return this.router.createUrlTree(['/login']);
        }

        if (requiredRoles && !requiredRoles.includes(user.role)) {
          return this.router.createUrlTree(['/unauthorized']);
        }

        return true;
      })
    );
  }
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: Add Angular auth and role guards"
```

---

## Task 13: Update Angular App Configuration

**Files:**
- Modify: `client/src/app/app.module.ts`
- Modify: `client/src/app/app-routing.module.ts`

**Step 1: Update app.module.ts to include HttpClient and interceptor**

Update `client/src/app/app.module.ts`:

```typescript
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { AuthInterceptor } from './interceptors/auth.interceptor';

@NgModule({
  declarations: [
    AppComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: Configure Angular HttpClient with auth interceptor"
```

---

## Task 14: Test the API

**Step 1: Update the database**

Run:
```bash
cd server/MusicTheory.API && dotnet ef database update
```
Expected: Database created and migrations applied

**Step 2: Start the API**

Run:
```bash
cd server/MusicTheory.API && dotnet run
```
Expected: API starts on https://localhost:5001 (or similar)

**Step 3: Test with Swagger**

Open browser to: `https://localhost:5001/swagger`

Test the following:
1. POST /api/auth/register - Create a new user
2. POST /api/auth/login - Login with the user
3. GET /api/users/me - Get current user (with Bearer token)

**Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: Address any issues found during testing"
```

---

## Summary

Phase 1 Foundation is complete when:

- [x] Database models created (User, TeacherProfile, StudentProfile, Enrollment, Invitation)
- [x] EF Core DbContext with Identity integration
- [x] JWT authentication with refresh tokens
- [x] Auth endpoints (register, login, refresh, logout)
- [x] Users endpoint (get/update current user)
- [x] Angular auth service and interceptor
- [x] Angular auth guards
- [x] Database migrations
- [x] API tested via Swagger

**Next Phase:** Phase 2 - Teacher-Student Core (Profiles, Invitations, Enrollments, Basic Dashboards)

---

## Files Created/Modified Summary

### Server (New Files)
```
server/MusicTheory.API/
├── Data/
│   └── MusicTheoryDbContext.cs
├── Models/
│   ├── Entities/
│   │   ├── User.cs
│   │   ├── TeacherProfile.cs
│   │   ├── StudentProfile.cs
│   │   ├── Enrollment.cs
│   │   ├── Invitation.cs
│   │   └── RefreshToken.cs
│   ├── Enums/
│   │   ├── UserRole.cs
│   │   ├── EnrollmentStatus.cs
│   │   └── ProgressionMode.cs
│   └── DTOs/
│       ├── Auth/
│       │   ├── RegisterRequest.cs
│       │   ├── LoginRequest.cs
│       │   ├── AuthResponse.cs
│       │   └── RefreshTokenRequest.cs
│       └── User/
│           ├── UserDto.cs
│           └── UpdateUserRequest.cs
├── Services/
│   ├── IJwtService.cs
│   ├── JwtService.cs
│   ├── IAuthService.cs
│   ├── AuthService.cs
│   ├── IUserService.cs
│   └── UserService.cs
├── Controllers/
│   ├── AuthController.cs
│   └── UsersController.cs
├── appsettings.json (modified)
├── appsettings.Development.json (new)
├── Startup.cs (modified)
└── MusicTheory.API.csproj (modified)
```

### Client (New Files)
```
client/src/
├── app/
│   ├── models/
│   │   ├── auth.model.ts
│   │   └── user.model.ts
│   ├── services/
│   │   └── auth.service.ts
│   ├── interceptors/
│   │   └── auth.interceptor.ts
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   └── role.guard.ts
│   └── app.module.ts (modified)
└── environments/
    ├── environment.ts
    └── environment.prod.ts
```
